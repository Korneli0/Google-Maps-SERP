# Review Intelligence

> Review scraping, deduplication, enrichment, and 150+ metric analysis pipeline across 10 categories.

## Module Map

```
src/lib/
├── reviewScraper.ts          → Playwright scraper for Google Reviews
├── reviewAnalyzer.ts         → Entry point, deduplication, orchestration
├── reviewAnalyzerTypes.ts    → All type definitions (150+ metrics)
├── reviewAnalyzerCompute.ts  → Overview, Sentiment, Ratings, Responses
├── reviewAnalyzerCompute2.ts → Content, Legitimacy, Temporal, Actions, Competitive, Reviewer
└── sentimentEngine.ts        → Hybrid VADER/AFINN sentiment (see sentiment-engine.md)
```

## Pipeline

```
POST /api/reviews (SSE stream)
      │
      ├─ 1. Create ReviewAnalysis record (status: SCRAPING)
      ├─ 2. scrapeGoogleReviews(url, onProgress)
      │        ├─ Launch headless Chrome
      │        ├─ Navigate to business page
      │        ├─ Extract business info (name, rating, count)
      │        ├─ Click Reviews tab
      │        ├─ Sort by Newest
      │        ├─ Scroll & collect all reviews
      │        └─ Return { business, reviews[] }
      │
      ├─ 3. Save reviews to DB in chunks
      ├─ 4. Status → ANALYZING
      ├─ 5. analyzeReviews(reviews)
      │        ├─ Deduplicate (fingerprint)
      │        ├─ Enrich (sentiment + fake score)
      │        └─ Compute 10 metric categories
      │
      ├─ 6. Save analysisData JSON blob to DB
      └─ 7. Status → COMPLETED
```

## SSE Streaming

The `/api/reviews` POST endpoint uses Server-Sent Events to stream real-time progress:

```typescript
const stream = new TransformStream();
const writer = stream.writable.getWriter();
// ...
return new Response(stream.readable, {
    headers: { 'Content-Type': 'text/event-stream', ... }
});
```

Progress messages are sent via `onProgress` callback → SSE `data:` events.

---

## Review Scraper

> `src/lib/reviewScraper.ts`

### `scrapeGoogleReviews(businessUrl, onProgress?)`

Returns `{ business: ScrapedBusinessInfo, reviews: ScrapedReview[] }`.

### ScrapedReview Type

```typescript
interface ScrapedReview {
    reviewId?: string;       // Google's unique review ID (data-review-id)
    reviewerName: string;
    reviewerUrl?: string;    // Profile link (data-href)
    reviewImage?: string;    // Photo URL from button background-image
    reviewCount?: number;    // Reviewer's total review count
    photoCount?: number;     // Reviewer's total photo count
    rating: number;          // 1-5
    text?: string;
    publishedDate?: string;  // Relative ("2 months ago")
    responseText?: string;   // Owner's response
    responseDate?: string;   // Owner's response date
}
```

### Browser Configuration

| Setting | Value |
|---------|-------|
| Viewport | 1400 × 900 |
| User Agent | Chrome 122 on Mac |
| Locale | `en-US` |
| URL params | `hl=en`, `gl=us` forced |
| Service Workers | Blocked |

### Retry Logic

3 attempts with full re-navigation between failures. 3-second wait between retries.

### Business Info Extraction

`extractBusinessInfo(page)` extracts from the business panel:

| Field | Selectors |
|-------|-----------|
| Name | `h1.DUwDvf`, `h1 span` |
| Rating | `div.F7nice span[aria-hidden="true"]`, `span.ceNzKf`, `div.fontDisplayLarge` — handles both `.` and `,` decimal separators |
| Total Reviews | 3 approaches: (1) `div.F7nice span[aria-label*="review"]`, (2) text patterns in containers `(1,234)` or `1234 reviews`, (3) tab button text |
| Place ID | URL regex: `!1s(ChIJ...)` or `!1s(0x...:0x...)` |

If `totalReviews` is 0 after first extraction, waits 5 seconds and retries.

### Reviews Tab Navigation

`openReviewsTab(page)` — 3 strategies:

1. `button[aria-label*="Reviews"]` or `button[data-tab-id="reviews"]`
2. All `button[role="tab"]` — find one with a number and "review" text, or click 2nd tab
3. `span[aria-label*="review"]` — click the review count text

### Sort by Newest

`sortReviewsByNewest(page)`:
1. Click `button[aria-label="Sort reviews"]` or `button[data-value="Sort"]`
2. Click `div[role="menuitemradio"]:has-text("Newest")` or `li[data-index="1"]`

Falls back to default "Most Relevant" if sorting fails.

### Scroll & Collect

`scrollAndCollectReviews(page, expectedTotal, log)`:

```
maxScrollAttempts = min(expectedTotal × 3, 3000)
scrollContainer = "div.m6QErb.DxyBCb.kA9KIf.dS8AEf" or "div.m6QErb.DxyBCb"

for i in 0..maxScrollAttempts:
    scroll container to bottom
    wait 800ms

    every 5th iteration:
        expand all "More" buttons (button.w8nwRe.kyuRq)

    count unique data-review-id elements

    if no new reviews:
        noNewReviewsCount++
        if count > 5: "jiggle" scroll (up 500px, wait 200ms, down 500px)
        if count > 40: stop (stalled)
    else:
        noNewReviewsCount = 0

    if currentCount >= expectedTotal: stop
```

### DOM Selectors for Review Data

| Field | Selector | Extraction |
|-------|----------|-----------|
| Review ID | `data-review-id` attribute | Unique Google ID |
| Reviewer Name | `div.d4r55` or `button.WEBjve div.d4r55` | `.textContent` |
| Profile URL | `button.WEBjve` | `data-href` attribute |
| Review Image | `button.Tya61d` | Background-image URL from `style` attribute |
| Rating | `span.kvMYJc` | `aria-label` → parse first digit |
| Text | `span.wiI7pd` | `.textContent` |
| Date | `span.rsqaWe` | `.textContent` (relative: "2 months ago") |
| Owner Response | `div.CDe7pd` container | Date: `span.DZSIDd`, Text: `div.wiI7pd` |
| Review Count | Full text | Regex `(\d+)\s*reviews?` |
| Photo Count | Full text | Regex `(\d+)\s*photos?` |

Only reviews with `rating > 0` are kept.

### Deduplication (Scraper Level)

Post-extraction dedup by `reviewId` only (Google's unique ID). Reviews without IDs are always kept. No semantic dedup by name/rating/text — different people can share names and ratings.

Nested elements filtered: only outermost `div[data-review-id]` elements kept (checks if any ancestor also has `data-review-id`).

---

## Review Analyzer

> `src/lib/reviewAnalyzer.ts`

### `analyzeReviews(reviews: ScrapedReview[]): ReviewAnalysisResult`

### Step 1: Deduplication (Analyzer Level)

Fingerprint: `{reviewerName.toLowerCase()}|{rating}|{first50chars of text}`

Keeps first occurrence. This catches duplicates that passed the scraper (e.g., from retry scrolls).

### Step 2: Enrichment

`enrichReviews(deduplicated)` adds to each review:
- `sentimentScore`, `sentimentLabel` — from `analyzeSentiment(text, rating)`
- `fakeScore` — from `calculateFakeScore(review)`
- `wordCount` — word count of text

### Step 3: Compute All Metrics

Calls 10 compute functions, each returning a category object:

| Function | Category | Source File |
|----------|----------|-------------|
| `computeOverview` | Overview (15 metrics) | reviewAnalyzerCompute.ts |
| `computeSentiment` | Sentiment (14 metrics) | reviewAnalyzerCompute.ts |
| `computeRatings` | Ratings (13 metrics) | reviewAnalyzerCompute.ts |
| `computeResponses` | Responses (14 metrics) | reviewAnalyzerCompute.ts |
| `computeLegitimacy` | Legitimacy (17 metrics) | reviewAnalyzerCompute2.ts |
| `computeContent` | Content (18 metrics) | reviewAnalyzerCompute2.ts |
| `computeTemporal` | Temporal (13 metrics) | reviewAnalyzerCompute2.ts |
| `computeCompetitive` | Competitive (5 metrics) | reviewAnalyzerCompute2.ts |
| `computeReviewer` | Reviewer (5 metrics) | reviewAnalyzerCompute2.ts |
| `computeActions` | Actions (recommendations) | reviewAnalyzerCompute2.ts |

---

## Fake Score Calculation

`calculateFakeScore(review)` — 0 to 100 (capped). Higher = more suspicious.

| Indicator | Points |
|-----------|--------|
| No text or < 20 chars | +15 |
| Single-review account | +20 |
| ≤3 total reviews | +10 |
| No photos ever (photoCount = 0) | +5 |
| Extreme rating (1 or 5) + minimal text (< 30 chars) | +10 |
| ALL CAPS text | +5 |
| Generic boilerplate ("great place", "nice place", "good service", etc.) | +15 |
| Rating-text misalignment (5★ negative text, 1★ positive text) | +15 |
| Repetitive text (unique word ratio < 50%) | +10 |

---

## Metric Categories

### Overview (15 metrics)

| Metric | Formula |
|--------|---------|
| healthScore | `50 + (avgRating-3)×10 + min(avgSentiment×15, 12) + min(responseRate/4, 12) - fakePercentage/4 ± NPS/10` |
| gradeLabel | A+ (≥90), A (≥80), B+ (≥70), B (≥60), C (≥50), D (≥40), F (<40) |
| netPromoterScore | `(promoters% - detractors%)` where 4-5★ = promoters, 1-2★ = detractors |
| customerSatisfactionIndex | `(avgRating / 5) × 100` |
| reputationMomentum | `RISING` if recent 3mo avg > older 3mo avg + 0.2, `FALLING` if < -0.2, else `STABLE` |
| reviewAuthenticityScore | `100 - fakeReviewPercentage` |
| engagementScore | `min(100, (avgWordCount/5) + (responseRate/2) + (reviewsWithText/total × 30))` |
| strengthsSummary | Auto-generated from metrics (high rating, good response rate, etc.) |
| weaknessesSummary | Auto-generated from metrics (low rating, low response rate, etc.) |
| riskAlerts | Auto-generated from thresholds (high fake %, declining rating, etc.) |

### Sentiment (14 metrics)

- `overallScore`, `overallLabel`, positive/negative/neutral/mixed counts
- `sentimentTrend` — monthly average sentiment
- `mostPositiveReview`, `mostNegativeReview` — extreme examples
- `emotionBreakdown` — counts per emotion (from `detectEmotionAdvanced()`)
- `sentimentByRating` — average sentiment per star rating
- `ratingTextAlignment` — % where rating matches sentiment direction
- `sarcasmSuspectCount` — contradictory sentiment/rating reviews
- `aspectSentiments` — aggregated aspect scores across all reviews

### Ratings (13 metrics)

- `distribution` — count and percentage per star (1-5)
- `standardDeviation` — rating variance
- `ratingTrend` — monthly average rating
- `ratingVelocity` — reviews per month
- `improvingOrDeclining` — `IMPROVING` if recent 3mo > older 3mo + 0.1, `DECLINING` if < -0.1
- `polarizationIndex` — `(1★ + 5★) / total` (high = polarized)
- `recentVsOverallDelta` — delta between recent and historical average
- `weightedRating` — recency-weighted (newer reviews get higher weight)
- `bayesianAverage` — `(v/(v+m)) × R + (m/(v+m)) × C` where C=3.5, m=10
- `ratingEntropy` — Shannon entropy of rating distribution

### Responses (14 metrics)

- `responseRate` — % of reviews with owner response
- `responseRateNegative` / `responseRatePositive` — differential rates by rating
- `templateDetectionRate` — % of responses with identical first 100 chars
- `empathyScore` — % containing empathy words: sorry, apologize, understand, appreciate, thank you, grateful, value, care, concern, improve
- `resolutionLanguageRate` — % containing: resolve, fix, address, correct, refund, replace, compensate, follow up, contact us, reach out
- `defensiveLanguageRate` — % containing: actually, however, incorrect, wrong, false, untrue, never happened, disagree
- `personalizedRate` — % mentioning reviewer's first name
- `responseQualityScore` — composite: `empathy×0.3 + personalized×0.2 + (avgLength/5)×0.2 + (100-template)×0.15 + (100-defensive)×0.15`
- `unrespondedNegatives` — top 10 negative reviews without responses

### Legitimacy (17 metrics)

- `overallTrustScore` — `100 - (suspicious / total × 100)`
- Suspicious counts/percentages: flagged reviews, one-review accounts, low-effort, rating-only, photoless
- `velocitySpikes` — months with > 2.5× average volume
- `duplicateContentCount` — reviews with identical first 80 chars
- `reviewerDiversityIndex` — Shannon entropy of reviewer distribution (0=single reviewer, 1=perfectly diverse)
- `fakeScoreDistribution` — bucketed: 0-20 (Likely Real), 21-40 (Low Risk), 41-60 (Medium), 61-80 (High), 81-100 (Likely Fake)
- `topSuspiciousReviews` — top 5 by fake score

### Content (18 metrics)

- `topKeywords` — top 40, filtered by 90+ stopwords, tagged positive/negative/neutral
- `topPhrases` — top 20 bigrams occurring ≥2×
- `trigrams` — top 15 trigrams occurring ≥2×
- `complaintThemes` — Wait Times, Customer Service, Quality, Cleanliness, Pricing, Communication, Dishonesty, Safety
- `praiseThemes` — Service Quality, Staff, Value, Atmosphere, Expertise, Reliability, Results
- `languageQualityScore` — base 50, bonuses for length/punctuation/casing, penalties for excessive punctuation
- `readabilityScore` — Flesch-Kincaid grade level
- `uniqueWordRatio` — vocabulary diversity
- `emojiUsageRate` — % of reviews with emojis
- `mentionedStaff` — names mentioned ≥3× (filters common names, days, months)
- `servicesMentioned` — Installation, Repair, Consultation, Delivery, Maintenance, Support
- `competitorMentions` — via indicators: "better than", "worse than", "switched from", "prefer"

### Temporal (13 metrics)

- `reviewsPerMonth` — count per YYYY-MM
- `averageReviewsPerMonth`, `busiestMonth`, `slowestMonth`
- `recentTrend` — `ACCELERATING` if recent 3mo avg > prev 3mo × 1.2, `DECELERATING` if < 0.8
- `recencyScore` — 80-95 if recent avg > 2-5/month, 30 if < 1/month
- `growthRate` — `((recentAvg - prevAvg) / prevAvg) × 100`
- `burstPeriods` — months with > 2× average volume
- `reviewLifespan` — months between first and last review

### Competitive (5 metrics)

Industry benchmarks (hardcoded baselines):

| Metric | Your Value | Benchmark | Verdict |
|--------|-----------|-----------|---------|
| Average Rating | calculated | 4.2 | Above/Below Average |
| Response Rate | calculated | 30% | Healthy/Needs Attention |
| Authenticity | calculated | 85% | Strong/Average/Weak |
| NPS | calculated | 30 | Good/Needs Improvement |
| Engagement | calculated | 50 | Active/Moderate/Low |

### Reviewer (5 metrics)

- `averageReviewsPerReviewer`, `averagePhotosPerReviewer`
- `topReviewers` — top 10 by review count + average rating
- `returningReviewers` — count with multiple/updated reviews
- `reviewerLoyaltyIndicators`

### Actions (recommendations)

- **Priority Issues** — generated from thresholds: low negative response rate (<50% → HIGH), high template rate (>30% → MEDIUM), defensive language (>20% → HIGH), high 1-star ratio (>15% → HIGH), rating decline → CRITICAL, suspicious reviews >15% → MEDIUM
- **Quick Wins** — respond to unanswered negatives, rewrite templates, ask satisfied customers
- **Long-Term Strategies** — root cause analysis, satisfaction program (if NPS < 20), systematic review process
- **Suggested Responses** — 5 templates based on rating context (1-2★: empathetic, 3★: balanced, 4-5★: grateful)
