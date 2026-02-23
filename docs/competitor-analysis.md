# Competitor Analysis & Insight Engine

> `src/lib/analysis.ts` — Competitor intelligence aggregation from scan results.
> `src/lib/insightEngine.ts` — Strategic threat scoring, market saturation, and opportunity detection.

## Competitor Intelligence

### `analyzeCompetitors(results, targetBusinessName?): CompetitorIntelligence`

Aggregates all `topResults` JSON blobs from grid points into a unified competitor landscape.

### Data Flow

```
Result[] (each with topResults JSON of ~20 businesses)
    │
    ├─ Parse each topResults JSON
    ├─ Aggregate by business name (lowercase key)
    ├─ Skip target business (if specified)
    ├─ Calculate per-competitor metrics
    │
    └─ Output:
         ├─ competitors: CompetitorProfile[]
         ├─ categoryMetrics: CategoryMetrics
         ├─ reviewMetrics: ReviewMetrics
         └─ profileMetrics: ProfileMetrics
```

### CompetitorProfile

Per unique business across all grid points:

| Field | Computation |
|-------|------------|
| appearances | Count of grid points where this business appeared |
| avgRank | Running average: `((prev × (n-1)) + rank) / n` |
| bestRank | `min()` across appearances |
| worstRank | `max()` across appearances |
| rating, reviews, cid, placeId | Latest non-null value from any appearance |
| photosCount | `max()` across appearances |

Sorted by appearances (most dominant first).

### CategoryMetrics

| Metric | Computation |
|--------|------------|
| totalCategories | Count of unique categories |
| avgCategoriesPerBusiness | Average of `allCategories.length` per business |
| maxCategories | Max categories any single business has |
| topCategories | Sorted by count, with percentage of total, avg rating, avg reviews |

### ReviewMetrics

Computed from **unique businesses** (not per-appearance, to avoid double-counting):

| Metric | Description |
|--------|------------|
| avgRating | Mean rating across unique businesses |
| avgReviews | Mean review count |
| totalReviews | Sum of all reviews |
| maxReviews / minReviews | Range |
| withoutReviews | Count with 0 reviews |
| ratingDistribution | Count per star (1-5) + "none" |

### ProfileMetrics

| Metric | Description |
|--------|------------|
| avgCompleteness | Mean profile completeness score (0-100) |
| withPhone | Count with phone number |
| withWebsite | Count with website |
| withAddress | Count with address |
| serviceAreaBusinesses | Count of SABs |
| physicalLocations | Count of non-SABs |

## Helper Functions

```typescript
generateReviewLink(placeId: string): string
// → "https://search.google.com/local/writereview?placeid={placeId}"

cidToMapsUrl(cid: string): string
// → "https://maps.google.com/?cid={cid}"

extractCidFromUrl(url: string): string | null
// Parses ?cid=123456 or 0x...:0x(hex) → decimal

extractPlaceIdFromUrl(url: string): string | null
// Parses place_id=, !19s(...), or ftid=
```

---

## Insight Engine

> `src/lib/insightEngine.ts`

### `generateInsights(competitors, gridPointCount, yourProfile?): InsightResult`

Main entry point that computes all strategic intelligence.

### InsightResult

```typescript
interface InsightResult {
    threatLevel: 'low' | 'medium' | 'high' | 'critical';
    threatScore: number;
    marketSaturation: number;        // 0-100
    topThreats: CompetitorThreat[];  // top 5
    opportunities: Opportunity[];
    recommendations: Recommendation[];
    categoryDominance: CategoryAnalysis[];
}
```

## Threat Scoring

### `calculateThreatScore(competitor, totalAppearances): number` (0-100)

| Component | Weight | Thresholds |
|-----------|--------|-----------|
| **Ranking Dominance** | 40% | Rank ≤3: +40, ≤5: +30, ≤10: +20, ≤15: +10 |
| **Review Power** | 25% | Reviews ≥500: +25, ≥200: +20, ≥100: +15, ≥50: +10, ≥20: +5 |
| **Rating Quality** | 15% | Rating ≥4.8: +15, ≥4.5: +12, ≥4.0: +8, ≥3.5: +4 |
| **Market Presence** | 20% | `(appearances / totalAppearances) × 20` |

### Overall Threat Level

Based on average threat score of top 5 competitors:

| Avg Score | Level |
|-----------|-------|
| ≥ 75 | critical |
| ≥ 55 | high |
| ≥ 35 | medium |
| < 35 | low |

### Competitor Strengths

Detected per competitor:
- High rating (≥ 4.5)
- Strong review count (≥ 100)
- Top 3 ranking
- Complete profile (≥ 70%)
- Established business (≥ 5 years)
- Physical location (not SAB)

### Competitor Weaknesses

- Low rating (< 4.0)
- Few reviews (< 50)
- Incomplete profile (< 50%)
- No physical location (SAB)
- Hidden address

## Market Saturation

### `calculateMarketSaturation(competitors, gridPointCount): number` (0-100)

| Unique Competitors | Base Score |
|-------------------|-----------|
| ≥ 50 | 90 |
| ≥ 30 | 70 |
| ≥ 15 | 50 |
| ≥ 8 | 30 |
| < 8 | 15 |

Density adjustment: if `avgCompetitorsPerPoint > 15` → `+10` (capped at 100).

## Opportunity Detection

### `findOpportunities(yourProfile, competitors, categoryAnalysis): Opportunity[]`

| Type | Condition | Priority |
|------|-----------|----------|
| Review Leader | Your reviews ≥ 1.5× competitor avg | High (impact: 85) |
| Category | < 3 competitors AND < 50 avg reviews in category | Medium (impact: 60) |
| Profile Gap | > 60% of competitors have < 50% completeness | High (impact: 70) |

Sorted by potential impact (descending).

## Recommendations

### `generateRecommendations(yourProfile, competitors, saturation): Recommendation[]`

| Priority | Condition | Action |
|----------|-----------|--------|
| 1 | Profile completeness < 70% | Complete Google Business Profile |
| 2 | Reviews < 50% of competitor avg | Increase review generation |
| 3 | Market saturation > 70% | Focus on hyper-local targeting |
| 4 | Rating < 4.5 | Improve service quality |

## Category Dominance

### `analyzeCategoryDominance(competitors): CategoryAnalysis[]`

Groups competitors by primary category:

| Field | Description |
|-------|------------|
| category | Category name |
| competitorCount | Number of competitors in this category |
| avgRating | Mean rating within category |
| avgReviews | Mean reviews within category |
| dominantPlayer | Business with best (lowest) rank in category |

Sorted by competitorCount descending (most competitive first).
