# Google Maps Scraper — Deep Technical Reference

> **Source files:**
> - `src/lib/scraper.ts` — Main scraper (700 lines). Entry point + DOM fallback + API extraction.
> - `src/lib/apiParser.ts` — Standalone API parser (606 lines). Duplicates much of the API extraction logic for reuse outside the scraper. **Not currently imported by the scraper** — the scraper has its own inline `extractFromAPIData()`.
> - `src/lib/scanner.ts` — Orchestrator that calls `scrapeGMB()` per grid point.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [The ScrapeResult Type](#the-scraperesult-type)
3. [Step 1: Navigation](#step-1-navigation)
4. [Step 2: Consent Handling](#step-2-consent-handling)
5. [Step 3: Waiting for Results](#step-3-waiting-for-results)
6. [Step 4: Scrolling to Load All Results](#step-4-scrolling-to-load-all-results)
7. [Step 5: Extraction Strategy Selection](#step-5-extraction-strategy-selection)
8. [Primary Extraction: APP_INITIALIZATION_STATE Parsing](#primary-extraction-app_initialization_state-parsing)
9. [Fallback Extraction: DOM Scraping](#fallback-extraction-dom-scraping)
10. [Profile Completeness Score](#profile-completeness-score)
11. [The apiParser.ts Module](#the-apiparserts-module)
12. [How the Scanner Calls the Scraper](#how-the-scanner-calls-the-scraper)
13. [Logging & Observability](#logging--observability)
14. [Improvement Opportunities](#improvement-opportunities)

---

## Architecture Overview

The scraping pipeline has 5 sequential phases for each grid point:

```
                        ┌──────────────────────────────┐
                        │  scanner.ts calls scrapeGMB()│
                        └───────────┬──────────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │ 1. Navigate to Google Maps URL │
                    │    30s timeout, domcontentloaded│
                    └───────────────┬───────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │ 2. Handle consent dialog       │
                    │    2s quick check, multi-lang  │
                    └───────────────┬───────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │ 3. Wait for result selectors   │
                    │    20s timeout, 3 selectors    │
                    └───────────────┬───────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │ 4. Scroll results feed         │
                    │    Up to 12 iterations         │
                    └───────────────┬───────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │ 5. Extract business data       │
                    │                               │
                    │  ┌─────────────────────────┐  │
                    │  │ Try API extraction first │  │
                    │  │ (APP_INITIALIZATION_STATE│  │
                    │  └────────┬────────────────┘  │
                    │           │                    │
                    │      success?                  │
                    │       │     │                  │
                    │      yes    no                 │
                    │       │     │                  │
                    │       │  ┌──▼───────────────┐  │
                    │       │  │ DOM scraping     │  │
                    │       │  │ fallback         │  │
                    │       │  └──────────────────┘  │
                    │       │                        │
                    └───────┴────────────────────────┘
                                    │
                                    ▼
                          ScrapeResult[] (up to 20-25)
```

**Key design decision:** The scraper receives a Playwright `Page` object from the scanner. It does NOT create its own browser context — the scanner handles browser lifecycle, proxy rotation, and geolocation spoofing. The scraper is purely a "navigate, scroll, extract" function.

---

## The ScrapeResult Type

Every extracted business is returned as a `ScrapeResult`. This is the contract between the scraper and the rest of the system (scanner, export, analysis):

```typescript
// src/lib/scraper.ts:4-29
export interface ScrapeResult {
    name: string;           // Business name (always present)
    rating?: number;        // Star rating, e.g. 4.7
    reviews?: number;       // Review count, e.g. 286
    address?: string;       // Street address or empty string
    url?: string;           // Google Maps URL (CID-based: https://www.google.com/maps?cid=...)
    rank: number;           // 1-based position in search results

    // Enhanced fields
    category?: string;      // Primary business category
    isSAB?: boolean;        // Service Area Business (no storefront)
    phone?: string;         // Phone number (various formats)
    website?: string;       // Business website URL
    priceLevel?: string;    // $, $$, $$$, $$$$

    // Deep GBP extraction fields
    cid?: string;           // Google Customer ID (decimal string, e.g. "1234567890")
    placeId?: string;       // Google Place ID (e.g. "ChIJ...")
    allCategories?: string[];     // All categories (primary + secondary)
    attributes?: string[];        // Business attributes — NEVER POPULATED (declared but unused)
    hours?: string;               // Business hours — NEVER POPULATED (declared but unused)
    photosCount?: number;         // Number of photos (API extraction only)
    yearsInBusiness?: number;     // Years operating (DOM extraction only)
    openNow?: boolean;            // Currently open (DOM extraction only)
    profileCompleteness?: number; // 0-100 score
    businessProfileId?: string;   // 19-digit Google Business Profile ID (API extraction only)
}
```

**Important:** Several fields are declared in the interface but never populated by either extraction path:
- `attributes` — declared but no extraction code exists
- `hours` — declared but no extraction code exists

Some fields are only populated by one extraction path:
- `photosCount`, `businessProfileId` — API extraction only
- `yearsInBusiness`, `openNow` — DOM extraction only

---

## Step 1: Navigation

```typescript
// src/lib/scraper.ts:37-45
await page.goto(
    `https://www.google.com/maps/search/${encodeURIComponent(keyword)}/@${lat},${lng},15z/?hl=en`,
    { waitUntil: 'domcontentloaded', timeout: 30000 }
);
```

### URL Anatomy

Given keyword `"pizza delivery"` at coordinates `40.7580, -73.9855`:

```
https://www.google.com/maps/search/pizza%20delivery/@40.758,-73.9855,15z/?hl=en
                                  ▲                   ▲      ▲       ▲    ▲
                                  │                   │      │       │    │
                            URI-encoded keyword    lat    lng   zoom  language
```

| Parameter | Value | Purpose |
|-----------|-------|---------|
| `search/{keyword}` | URI-encoded search term | What to search for |
| `@{lat},{lng}` | Decimal coordinates | Centers the map view |
| `15z` | Zoom level 15 | Street-level view (~500m visible area) |
| `hl=en` | Language hint | Request English results |

**What actually controls local results:** The zoom level and `@` coordinates influence which results Google returns, but the dominant signal is the **browser's geolocation** — which the scanner spoofs per grid point via Playwright's `geolocation` context option. The URL coordinates and the geolocation coordinates are always the same.

**Timeout behavior:** If the 30-second navigation timeout fires (e.g. due to dead proxy, network block, or captcha redirect), the error propagates up to the scanner's retry logic, which will attempt up to 3 retries and may rotate to a different proxy.

**`waitUntil: 'domcontentloaded'`:** This fires when the initial HTML is parsed, not when all resources finish loading. This is intentional — Google Maps is a heavy SPA that continues loading assets long after the DOM is ready. Waiting for `'load'` or `'networkidle'` would be unreliable and slow.

---

## Step 2: Consent Handling

```typescript
// src/lib/scraper.ts:48-58
const consentSelector = [
    'button[aria-label="Accept all"]',           // English
    'button[aria-label="Alle akzeptieren"]',      // German
    'button[aria-label="قبول الكل"]',             // Arabic
    'form[action*="consent"] button:last-child'   // Generic fallback
].join(', ');

if (await page.locator(consentSelector).first().isVisible({ timeout: 2000 })) {
    await page.locator(consentSelector).first().click();
    await page.waitForNavigation({ waitUntil: 'domcontentloaded' });
}
```

### Why This Exists

Google shows a GDPR/privacy consent dialog for users in the EU and some other regions. If not dismissed, it blocks the entire page — no search results are visible behind it.

### How It Works

1. **2-second visibility check** — This is the "fast path" optimization. In the happy case (no consent dialog, e.g. US coordinates), this times out quickly and continues. Without this short timeout, the scraper would wait much longer looking for a dialog that doesn't exist.

2. **Multi-language selectors** — The consent dialog language depends on the browser locale and/or the user's IP geolocation. Three languages are explicitly handled: English, German, Arabic. The generic fallback (`form[action*="consent"] button:last-child`) targets any consent form's last button (typically "Accept").

3. **The entire try/catch swallows errors** — If the consent check fails for any reason (timeout, missing element, click fails), the scraper silently continues. This is defensive — a consent dialog that doesn't exist shouldn't crash the scraper.

### Example Scenario

A grid point at coordinates `52.52, 13.405` (Berlin) with a proxy IP in Germany:
1. Google shows `"Alle akzeptieren"` dialog
2. Selector matches the German button
3. Click → navigation → results page loads

### Limitations

- Only 3 languages are covered. French (`"Tout accepter"`), Spanish (`"Aceptar todo"`), Italian, Dutch, Polish, etc. are **not handled**. The generic `form[action*="consent"]` fallback may or may not work for these.
- If Google changes the consent dialog's DOM structure (e.g. uses a different `action` attribute), the generic fallback breaks silently.

---

## Step 3: Waiting for Results

```typescript
// src/lib/scraper.ts:61-69
await page.waitForFunction(() => {
    return !!(
        document.querySelector('[role="article"]') ||
        document.querySelector('.qBF1Pd') ||
        document.querySelector('[role="feed"]')
    );
}, { timeout: 20000 });
```

This waits up to 20 seconds for any of three signals that results have started loading:

| Selector | What It Matches |
|----------|----------------|
| `[role="article"]` | Individual business listing cards |
| `.qBF1Pd` | Business name element class (Google-internal class name) |
| `[role="feed"]` | The scrollable results container |

**If none appear within 20 seconds**, the scraper logs a warning but **continues anyway** — it will attempt extraction on whatever content is on the page. This can happen when:
- Google shows a captcha instead of results
- The search returns zero results
- Google's SPA rendering is delayed
- A redirect occurred (e.g. to a single-business page instead of search results)

---

## Step 4: Scrolling to Load All Results

Google Maps lazy-loads business listings. Initially only 3-7 results are in the DOM. As the user scrolls, more load dynamically. The scraper must simulate scrolling to load all ~20 results for accurate rankings.

```typescript
// src/lib/scraper.ts:74-119
let previousCount = 0;
let noNewResultsStreak = 0;
const maxScrollIterations = 12;   // Hard limit — never scroll more than 12 times
const maxNoNewResults = 3;        // Stop if 3 consecutive scrolls add nothing

for (let i = 0; i < maxScrollIterations; i++) {
    // Count currently loaded results (whichever selector finds more)
    const currentCount = await page.evaluate(() => {
        const articles = document.querySelectorAll('[role="article"]');
        const links = document.querySelectorAll('a[href*="/maps/place/"]');
        return Math.max(articles.length, links.length);
    });

    // Stale check — did scrolling add any new results?
    if (currentCount === previousCount) {
        noNewResultsStreak++;
        if (noNewResultsStreak >= 3) break;  // All results loaded
    } else {
        noNewResultsStreak = 0;
    }
    previousCount = currentCount;

    // End-of-list detection
    const hitEnd = await page.evaluate(() => {
        const feed = document.querySelector('[role="feed"]');
        if (!feed) return false;
        const text = (feed as HTMLElement).innerText || '';
        return text.includes('end of the list') || text.includes('No more results');
    });
    if (hitEnd) break;

    // Scroll the feed container down by 1000px
    await page.evaluate(() => {
        const scrollable = document.querySelector('[role="feed"]') || document.body;
        scrollable.scrollBy(0, 1000);
    });

    // Human-like random delay: 800ms to 2000ms
    await page.waitForTimeout(800 + Math.random() * 1200);
}
```

### Scroll Timing Analysis

Best case (all 20 results already loaded): 1 iteration → ~1s
Typical case (20 results, loaded in batches): 4-6 iterations → ~5-10s
Worst case (slow loading, hits max): 12 iterations → ~12-24s

| Iteration | Time (ms) | Cumulative (s) | Action |
|-----------|-----------|-----------------|--------|
| 1 | 800-2000 | ~1.4 | Initial scroll, loads results 8-14 |
| 2 | 800-2000 | ~2.8 | Loads results 15-18 |
| 3 | 800-2000 | ~4.2 | Loads results 19-20, hits "end of list" |
| 4 | 800-2000 | ~5.6 | No new results (streak=1) |
| 5 | 800-2000 | ~7.0 | No new results (streak=2) |
| 6 | 800-2000 | ~8.4 | No new results (streak=3) → STOP |

### Stopping Conditions (First One Wins)

1. **Stale detection** — 3 consecutive scrolls produced no new results (most common)
2. **End-of-list text** — Google shows "You've reached the end of the list" or "No more results"
3. **Hard limit** — 12 scroll iterations maximum (safety valve)

### Why 1000px?

`scrollBy(0, 1000)` scrolls approximately 3-4 listing cards worth of content. This is enough to trigger Google's lazy-loading but small enough to feel natural. Scrolling by 10000px in one shot could trigger anti-bot detection.

### Why Random Delays?

The `800 + Math.random() * 1200` formula produces delays between 800ms and 2000ms. This:
- Gives Google time to load new results (800ms minimum)
- Looks like human scrolling speed (not machine-gun instant scrolls)
- Adds entropy to make the pattern less detectable across many requests

---

## Step 5: Extraction Strategy Selection

```typescript
// src/lib/scraper.ts:125-140
// PRIMARY: Try API data extraction
let apiResults = await extractFromAPIData(page);
if (apiResults && apiResults.length > 0) {
    return apiResults;  // ← Return immediately if API extraction works
}

// FALLBACK: DOM scraping
const results = await page.evaluate(() => {
    // ... (entire DOM scraping logic runs inside the browser)
});
return results;
```

**The API path is always attempted first** because it produces more accurate, structured data (phone, website, coordinates, place ID, business profile ID, photo count). DOM scraping is a lossy heuristic that depends on fragile CSS selectors and text parsing.

**The fallback triggers when:**
- `window.APP_INITIALIZATION_STATE` doesn't exist (rare — it's usually present)
- The data structure has changed (Google periodically reshuffles indices)
- The `rawData` string can't be parsed as JSON
- The recursive traversal finds 0 business entities

---

## Primary Extraction: APP_INITIALIZATION_STATE Parsing

This is the most complex part of the scraper. It reverse-engineers Google Maps' internal data format.

### What is APP_INITIALIZATION_STATE?

When Google Maps loads, it embeds a JavaScript variable called `window.APP_INITIALIZATION_STATE` containing pre-rendered data for the page. This includes all search results with their full metadata — ratings, addresses, phone numbers, Place IDs, coordinates, categories, and more.

This data is a deeply nested array-of-arrays structure. Google does not document this format; it's reverse-engineered by inspecting the data in browser DevTools.

### Step-by-step: How API Extraction Works

#### 1. Locate the Raw Data

```typescript
// src/lib/scraper.ts:413-428
const appState = (window as any).APP_INITIALIZATION_STATE;
if (!appState) return null;

// Search results live in appState[3], but the exact sub-path varies
let rawData: string | null = null;
if (appState[3]?.['ug']?.[2]) {
    rawData = appState[3]['ug'][2];       // Path A: appState[3].ug[2]
} else if (appState[3]?.[2]) {
    rawData = appState[3][2];             // Path B: appState[3][2]
}
```

`appState` is a large array. Index `[3]` contains the search results data. Within that, it can be at `.ug[2]` or directly at `[2]`. The code tries both.

#### 2. Clean and Parse the JSON String

```typescript
// src/lib/scraper.ts:434-443
let cleanData = rawData;
if (cleanData.startsWith(")]}'")) {
    cleanData = cleanData.substring(cleanData.indexOf('\n') + 1);
}
parsedData = JSON.parse(cleanData);
```

The raw data is a JSON string, often prefixed with `)]}'` — a common Google anti-JSON-hijacking prefix. This prefix must be stripped before parsing.

**Example of the raw data format:**
```
)]}'
[[null,null,[["0x89c2f...","Business Name",null,...],...],...]]
```

After stripping the prefix and parsing, `parsedData` is a deeply nested array.

#### 3. Find Business Entities via Recursive Traversal

```typescript
// src/lib/scraper.ts:448-473
function findListings(data: unknown, depth: number = 0): void {
    if (depth > 12 || businesses.length >= 25) return;

    if (Array.isArray(data)) {
        // Is this array a business entity?
        if (data.length > 15) {
            const name = safeGet(data, 11);
            const coords = safeGet(data, 9);
            const hasName = typeof name === 'string' && name.length > 1 && name.length < 200;
            const hasCoords = Array.isArray(coords) && coords.length >= 2;

            if (hasName && hasCoords) {
                businesses.push(data);
                return;  // Don't recurse into this — it's a complete entity
            }
        }

        // Not a business entity — recurse into each child
        for (const item of data) {
            findListings(item, depth + 1);
        }
    }
}
```

**Entity recognition heuristic:** A business listing array has:
- More than 15 elements (typical listings have 100+ indices)
- A string at index `11` (the business name) — between 1 and 200 characters
- An array at index `9` (coordinates) — with at least 2 elements

**Safety limits:**
- Max depth: 12 levels of recursion
- Max entities: 25 businesses (stops searching after finding 25)

**Example of a business entity array (simplified):**
```javascript
// indices:  0          1   2        ...  9                    10                      11
[            "ChIJ...", null, "123 Main St", ..., [null, null, 40.758, -73.985], "0x89c259....:0xabc123", "Joe's Pizza",
//  12   13                       14    ...  18
    null, ["Pizza", "Restaurant"], null, ..., "123 Main St, New York, NY 10001",
//  ...  78
    ..., "ChIJxxxxxx"
]
```

#### 4. Extract Fields from Each Entity

Once a business entity array is found, fields are extracted by index. Here is the complete field extraction map with actual code examples:

##### Name (index 11)

```typescript
const name = safeGet(biz, 11) as string || '';
// Example: "Joe's Pizza"
```

##### CID — Customer ID (index 10)

```typescript
const placeRef = safeGet(biz, 10) as string || '';
// Example placeRef: "0x89c2f60893b9d2b5:0x13a839e41ef1156f"

const match = placeRef.match(/0x[\da-fA-F]+:0x([\da-fA-F]+)/);
// match[1] = "13a839e41ef1156f"

cid = BigInt('0x' + match[1]).toString();
// cid = "1418849044207998319" (decimal)
```

The CID is a unique identifier for each Google Maps listing. It's stored as a hex pair in the data but Google's public URL uses the decimal form: `https://www.google.com/maps?cid=1418849044207998319`.

##### Coordinates (index 9)

```typescript
const coordsArr = safeGet(biz, 9) as number[] || [];
const latitude  = coordsArr[2] ?? coordsArr[0] ?? 0;
const longitude = coordsArr[3] ?? coordsArr[1] ?? 0;
```

The coordinates array has different layouts depending on the data version. It tries `[2],[3]` first (newer format) then `[0],[1]` (older format).

##### Categories (index 13)

```typescript
const rawCategories = safeGet(biz, 13) as unknown[] || [];
const categories: string[] = [];
for (const cat of rawCategories) {
    if (typeof cat === 'string') categories.push(cat);
    else if (Array.isArray(cat) && typeof cat[0] === 'string') categories.push(cat[0]);
}
// Example: ["Pizza", "Restaurant", "Delivery"]
```

Categories can be either flat strings or nested `[name, ...]` arrays — both formats are handled.

##### Rating and Reviews (index 4)

```typescript
const ratingData = safeGet(biz, 4) as number[] || [];
const rating  = (ratingData[7] ?? ratingData[0] ?? 0) as number;   // e.g. 4.7
const reviews = (ratingData[8] ?? ratingData[1] ?? 0) as number;   // e.g. 286
const priceLevel = safeGet(biz, 4, 2) as string || undefined;      // e.g. "$$"
```

Index `4` is a sub-array containing rating data. The rating float and review integer have migrated between sub-indices over time — hence the fallback chain.

##### Address (11 candidate indices + deep search fallback)

This is the most complex extraction. The scraper checks 11 known locations:

```typescript
const addressCandidates: string[] = [
    safeGet(biz, 18),              // Formatted address (most reliable)
    safeGet(biz, 39),              // Full address
    safeGet(biz, 2),               // Short address
    safeGet(biz, 14),              // Neighborhood/Area
    safeGet(biz, 3),               // Street/Building name
    safeGet(biz, 183, 1, 2),       // Address components (deep)
    safeGet(biz, 183, 1, 0),       // Street (deep)
    safeGet(biz, 183, 0, 0, 1),    // Alternative street (deep)
    safeGet(biz, 6, 2),            // Another possible location
    safeGet(biz, 42, 0),           // Pleper-style fallback
    safeGet(biz, 178, 0, 1),       // Near phone data
];
```

**Selection algorithm:**

```
For each candidate (in order):
  1. Skip null/empty candidates
  2. Skip rating patterns like "4.7(286)"
  3. Select the LONGEST candidate that passes validation:
     - If it came from index 18 or 39 (formatted addresses) → accept it regardless
     - Otherwise, must contain digits, street words, OR commas
```

**If no address is found from known indices, the deep search runs:**

```typescript
// Recursive scan of entire business object, depth limit 8
function deepFindAddress(obj, depth = 0): string | null {
    if (depth > 8) return null;
    // Accept strings where:
    //   - Length 5-150 characters
    //   - Contains a digit AND (comma OR street word)
    //   - NOT a rating, URL, phone number, separator, or control text
}

// Try specific sub-trees first, then scan everything
const fallback = deepFindAddress(safeGet(biz, 2))
    || deepFindAddress(safeGet(biz, 4))
    || deepFindAddress(safeGet(biz, 34))
    || deepFindAddress(safeGet(biz, 39))
    || deepFindAddress(safeGet(biz, 183))
    || deepFindAddress(safeGet(biz, 178))
    || deepFindAddress(biz);          // Last resort: scan entire object
```

**Street words recognized:**
```
st, street, ave, avenue, rd, road, blvd, dr, drive, ln, lane, way,
ct, court, pl, place, building, suite, floor, univ, campus, square,
market, plaza, hwy, highway, pkwy, parkway
```

##### Phone (index 178, 7)

```typescript
const phone = (safeGet(biz, 178, 0, 3) as string)
    || (safeGet(biz, 178, 0, 0) as string)
    || (safeGet(biz, 7, 0) as string)
    || '';
// Example: "+1 212-555-1234"
```

##### Website (index 7, 176)

```typescript
let website = (safeGet(biz, 7, 1) as string) || (safeGet(biz, 176, 0, 5) as string) || '';
if (website && !website.startsWith('http')) website = '';  // Validate URL
```

##### Place ID (index 78, 0)

```typescript
const placeId = (safeGet(biz, 78) as string) || (safeGet(biz, 0, 0, 1) as string) || '';
// Example: "ChIJd8BlQ2BZwokRjMKR3NGTODg"
```

##### Business Profile ID (index 10, 154 + recursive search)

```typescript
let businessProfileId = '';
const bpIdRaw = safeGet(biz, 10, 11) || safeGet(biz, 154, 0, 0);

if (bpIdRaw && /^\d{19}$/.test(String(bpIdRaw))) {
    businessProfileId = String(bpIdRaw);  // Direct match: 19-digit number
} else {
    // Recursive search of entire entity (depth limit 5) for any 19-digit number
    const findBPId = (obj, depth = 0): string | null => {
        if (depth > 5 || !obj) return null;
        if (typeof obj === 'string' || typeof obj === 'number') {
            const s = String(obj);
            if (/^\d{19}$/.test(s)) return s;
        }
        // ... recurse into children
    };
    businessProfileId = findBPId(biz) || '';
}
```

**Risk:** The recursive search for a 19-digit number could match non-profile IDs. However, 19-digit numbers are distinctive enough that false positives are rare in this context.

##### SAB (Service Area Business) Detection

```typescript
// Check multiple indicators
const servesText = String(safeGet(biz, 25) || safeGet(biz, 24) || '').toLowerCase();
const hasServesIndicator = servesText.includes('serves') || servesText.includes('service area');
const explicitSABFlag = safeGet(biz, 49) === 1 || safeGet(biz, 49) === true;
const sabHint = safeGet(biz, 33);
const hasSABHint = (Array.isArray(sabHint) && sabHint.length === 0) || sabHint === true;

const isPhysicalAddress = address && (/\d/.test(address) || address.split(',').length > 2);

// Decision tree
if (explicitSABFlag) {
    isSAB = true;
} else if (hasServesIndicator || hasSABHint) {
    if (!isPhysicalAddress) isSAB = true;
}

// Hard override: street number in address → physical location → NOT SAB
if (address && /\d+/.test(address)) {
    isSAB = false;
}
```

**SAB detection priority:**
1. Explicit flag at index 49 → SAB = true (highest priority)
2. "Serves"/"service area" text at index 24/25 → SAB = true (unless physical address found)
3. Empty array at index 33 → SAB = true (unless physical address found)
4. Address contains digits → SAB = false (override — this is a physical storefront)

##### URL Construction

```typescript
const url = cid ? `https://www.google.com/maps?cid=${cid}` : '';
// Example: "https://www.google.com/maps?cid=1418849044207998319"
```

URLs are constructed from the CID. If no CID was extracted, the URL is empty.

### Complete Field Extraction Index Map

| Index Path | Field | Type | Fallback Indices | Notes |
|-----------|-------|------|------------------|-------|
| `11` | name | string | — | Required. 1-200 chars. |
| `10` | CID (hex) | string | — | Format: `0x...:0x...`. Second half → decimal. |
| `9[2], 9[3]` | lat, lng | number | `9[0], 9[1]` | Newer format uses [2],[3]. |
| `13` | categories | string[] | — | Flat strings or `[name, ...]` arrays. |
| `18` | formatted address | string | `39, 2, 14, 3, 183, 6, 42, 178` | Longest valid candidate wins. |
| `178[0][3]` | phone | string | `178[0][0], 7[0]` | Raw phone string. |
| `7[1]` | website | string | `176[0][5]` | Must start with `http`. |
| `4[7]` | rating | number | `4[0]` | Float, e.g. 4.7. |
| `4[8]` | review count | number | `4[1]` | Integer. |
| `4[2]` | price level | string | — | `$`, `$$`, `$$$`, `$$$$`. |
| `6[1]` | photo count | number | — | Integer. |
| `78` | Place ID | string | `0[0][1]` | `ChIJ...` format. |
| `10[11]` | Business Profile ID | string | `154[0][0]`, recursive search | 19-digit number. |
| `25, 24` | "serves" text | string | — | SAB indicator text. |
| `49` | SAB flag | boolean/int | `33` (array hint) | Explicit SAB marker. |

---

## Fallback Extraction: DOM Scraping

When API extraction fails, the scraper falls back to parsing the visible DOM. This entire function runs inside `page.evaluate()` — it executes in the browser context, not in Node.js.

### Element Selection

```typescript
// Priority 1: Standard article elements
let items = Array.from(document.querySelectorAll('div[role="article"]'));

// Priority 2: If no articles found, use place links as anchors
if (items.length === 0) {
    const links = Array.from(document.querySelectorAll('a[href*="/maps/place/"]'));
    items = links.map(l => l.closest('div') || l).filter(Boolean);
}
```

Each `[role="article"]` element represents one business listing card in the Google Maps sidebar.

### Deduplication

```typescript
const seenNames = new Set();
// ...
if (seenNames.has(name.toLowerCase())) return;
seenNames.add(name.toLowerCase());
```

Prevents the same business from appearing twice (can happen with sponsored results or rendering duplicates). Case-insensitive comparison.

### Name Extraction (2 strategies)

```typescript
// Strategy A: aria-label attribute
const ariaLabel = item.getAttribute('aria-label');
if (ariaLabel && !ariaLabel.includes('stars') && ariaLabel.length > 2) {
    name = ariaLabel;
}

// Strategy B: CSS class selectors
if (!name) {
    const nameEl = item.querySelector('.fontHeadlineSmall, .qBF1Pd, [role="heading"]');
    name = nameEl?.textContent?.trim() || '';
}

// Cleanup: remove rating suffix and numbering
name = name.split(' · ')[0].replace(/\. \d+$/, '').trim();
```

**Why filter `stars` from aria-label?** Some rating elements have aria-labels like "4.5 stars 286 reviews" — using that as the name would be wrong.

**The `.qBF1Pd` class** is a Google-internal class that targets the business name element. It's fragile — Google can rename it at any time. The `[role="heading"]` selector is more stable but less specific.

### CID and Place ID from URL

```typescript
const linkEl = item.querySelector('a[href*="/maps/place/"]');
const url = linkEl ? linkEl.href : '';

// CID: hex pair in URL → decimal
const cidMatch = url.match(/0x[\da-fA-F]+:0x([\da-fA-F]+)/);
if (cidMatch) {
    cid = BigInt('0x' + cidMatch[1]).toString();
}

// Place ID: !19s parameter or ftid parameter
const placeIdMatch = url.match(/!19s([^!]+)/) || url.match(/ftid=([^&]+)/);
if (placeIdMatch) {
    placeId = decodeURIComponent(placeIdMatch[1]);
}
```

**Example URL being parsed:**
```
https://www.google.com/maps/place/Joe's+Pizza/data=!3m1!4b1!4m5!3m4!1s0x89c2598f988...!8m2!3d40.7!4d-73.99
                                                                                            ▲
                                                          The hex CID pair is here ──────────┘
```

### Rating and Reviews (4 fallback patterns)

```typescript
// Rating from aria-label
const ratingEl = item.querySelector('[role="img"][aria-label*="stars"]');
const ratingLabel = ratingEl?.getAttribute('aria-label') || '';
// Example: "4.5 stars 286 reviews"
const rating = parseFloat(ratingLabel.match(/([0-9.]+)\s+stars/)?.[1]);

// Reviews: try 4 patterns in order
const reviewPattern1 = ratingLabel.match(/\(([\d,]+)\)/);           // "(286)"
const reviewPattern2 = text.match(/([\d,]+)\s*reviews?/i);          // "286 reviews"
const reviewPattern3 = text.match(/([\d,]+)\s*Google\s*reviews/i);  // "286 Google reviews"
const reviewPattern4 = ratingLabel.match(/stars?\s+([\d,]+)/);      // "4.5 stars 286"
```

### Address Extraction

```typescript
// Find a line in the card text that looks like a street address
const address = lines.find(l =>
    l.match(/\d+/) &&             // Contains digits
    l !== name &&                  // Not the business name
    l.length > 5 &&               // Not too short
    !isRatingPattern(l) &&        // Not "4.7(286)"
    !l.includes(' · ')            // Not a category separator line
) || '';
```

This is a heuristic: "a text line with digits that isn't a rating or the business name is probably an address." It works well for US addresses (`123 Main St`) but can fail for:
- Addresses without street numbers (common outside the US)
- Apartment/unit numbers being picked up as standalone addresses
- Numbered business names like "7-Eleven"

### Category Extraction and Validation

Google Maps shows categories in lines with ` · ` separators, e.g.:
```
Pizza · Restaurant · $$ · Open until 10 PM
```

The scraper splits on ` · ` and validates each part:

```typescript
function isValidCategory(str: string): boolean {
    const cleaned = str.trim();
    if (!cleaned || cleaned.length < 2 || cleaned.length > 50) return false;

    // Reject non-category strings
    if (/^\$+$/.test(cleaned)) return false;                        // "$$$"
    if (isRatingPattern(cleaned)) return false;                     // "4.7(286)"
    if (/^\d+\.?\d*\s*(mi|km|miles?|meters?|ft)$/i.test(cleaned)) return false;  // "5 mi"
    if (/^[\d\s\-().+]+$/.test(cleaned) && cleaned.replace(/\D/g, '').length >= 7) return false; // Phone
    if (/^\d+\s+[A-Za-z]/.test(cleaned) && cleaned.length > 10) return false;    // Address
    if (/^(open|closed|opens?|closes?)\s*(at|now|24)/i.test(cleaned)) return false; // Hours
    if (/^\d{1,2}(:\d{2})?\s*(AM|PM)/i.test(cleaned)) return false;              // Time
    if (/^serves/i.test(cleaned)) return false;                     // SAB marker
    if (/^(https?:|www\.)/i.test(cleaned)) return false;            // URL
    if (/^[\d$.,\s]+$/.test(cleaned)) return false;                 // Pure numbers

    return true;
}
```

This is essentially a "reject everything that isn't a category" filter. It works well in practice because Google's category strings are simple text labels without numbers, punctuation, or special patterns.

### Phone Extraction (3 patterns)

```typescript
// US format: (555) 123-4567 or +1 555-123-4567
const phonePattern1 = text.match(/(\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/);

// International: +44 20 7946 0958
const phonePattern2 = text.match(/(\+\d{1,3}[-.\s]?\d{1,4}[-.\s]?\d{1,4}[-.\s]?\d{1,9})/);

// Button aria-label: "Call +1 555-123-4567"
const phoneBtn = item.querySelector('button[aria-label*="Call"], button[data-tooltip*="Call"], a[aria-label*="phone"]');
const phoneFromBtn = phoneBtn?.getAttribute('aria-label')?.match(/[\d\s\-().+]+/)?.[0]?.trim();

phone = phoneFromBtn || phonePattern1?.[1] || phonePattern2?.[1];
```

Button aria-label is preferred because it contains the cleanest phone number string.

### Website Detection (3 strategies)

```typescript
// Strategy 1: data-value attribute (most reliable)
const websiteBtn1 = item.querySelector('a[data-value="Website"]');

// Strategy 2: aria-label (reliable)
const websiteBtn2 = item.querySelector('a[aria-label*="Website"]');

// Strategy 3: any external link (least reliable — may match ad links)
const websiteBtn3 = item.querySelector('a[href^="http"]:not([href*="google.com"]):not([href*="maps.google"])');
```

### Other DOM-only Fields

```typescript
// Open Now — careful to NOT match "opens at 9 AM" (which means CLOSED)
const openNow = textLower.includes('open now') || textLower.includes('open 24 hours');

// Years in Business
const yearsMatch = text.match(/(\d+)\+?\s+years?\s+in\s+business/i);
// Example: "15+ years in business" → yearsInBusiness = 15

// Price Level
const priceLevelMatch = text.match(/(\$+)(?:\s|·|$)/);
// Example: "$$" from "Restaurant · $$ · Open"

// SAB Detection
const isSAB = text.includes('Serves') || text.includes('Service area') ||
    text.toLowerCase().includes('serves your area') ||
    !address;  // No address found → assume SAB
```

---

## Profile Completeness Score

Both extraction paths calculate an identical 0-100 score:

```typescript
function calculateCompleteness(data): number {
    let score = 0;
    if (data.name)                score += 15;   // Has a name
    if (data.rating)              score += 10;   // Has a rating
    if (data.reviews > 0)         score += 10;   // Has at least 1 review
    if (data.address)             score += 15;   // Has an address
    if (data.phone)               score += 10;   // Has a phone number
    if (data.website)             score += 10;   // Has a website
    if (data.categories?.length > 0) score += 10;  // Has primary category
    if (data.categories?.length > 1) score += 5;   // Has secondary categories
    if (data.priceLevel)          score += 5;    // Has price level
    if (!data.isSAB)              score += 5;    // Physical location (not SAB)
    // DOM path also adds:
    // if (data.yearsInBusiness)  score += 5;    // Has years in business
    return score;
}
```

**Maximum score:**
- DOM path: **100** (includes yearsInBusiness)
- API path: **95** (no yearsInBusiness extraction)

**Practical maximum:** Most businesses score 60-80. Getting 100 requires name + rating + reviews + address + phone + website + 2+ categories + price level + physical location + years in business — which very few listings have.

---

## The apiParser.ts Module

`src/lib/apiParser.ts` is a standalone 606-line module that duplicates much of the API extraction logic. **It is NOT imported by the scraper** — the scraper has its own inline `extractFromAPIData()`.

### Why Does It Exist?

It was likely written as a cleaner, standalone version of the extraction logic — possibly intended to replace the inline version or to be used by other parts of the system. It has:

- A richer `APIExtractedBusiness` type (includes `latitude`, `longitude`, `isVerified`, `kgId`, `hours`, `attributes`)
- An `parseAppInitializationState()` function that can parse from raw HTML (not just from `window`)
- An `parseMapSearchXHR()` function for parsing XHR responses from `/search?tbm=map`
- Better code organization (separate functions for entity finding, parsing, validation)

### Key Differences from Inline Extraction

| Feature | Inline (`scraper.ts`) | Standalone (`apiParser.ts`) |
|---------|----------------------|---------------------------|
| Entity recognition | `length > 15` + name at `[11]` + coords at `[9]` | `length > 15` + name at `[11]` + CID at `[10]` containing `0x` |
| Max recursion depth | 12 | 15 |
| Max entities | 25 | Unlimited |
| Address deep search | Yes (depth 8) | No |
| Business Profile ID | Yes (with recursive search) | No |
| `parseAppInitializationState()` | No | Yes (HTML parsing) |
| `parseMapSearchXHR()` | No | Yes (XHR parsing) |
| SAB detection | 4-level logic | Simple `!address` check |
| Actually used | Yes | **No** (not imported anywhere) |

---

## How the Scanner Calls the Scraper

The scanner (`src/lib/scanner.ts`) wraps each `scrapeGMB()` call with extensive setup:

### Browser Context Creation

For **every grid point**, the scanner creates a fresh, isolated browser context:

```typescript
// src/lib/scanner.ts:197-254
async function createFreshContext(b: Browser, lat: number, lng: number) {
    const { locale, timezoneId } = getRegionalSettings(scan.centerLat, scan.centerLng);

    // Viewport randomization: ±50px
    const widthJitter = Math.floor(Math.random() * 100) - 50;
    const heightJitter = Math.floor(Math.random() * 100) - 50;

    // Rotate between 4 User Agents
    const userAgents = [
        'Chrome/122 on macOS',
        'Chrome/122 on Windows',
        'Safari/17.3 on macOS',
        'Firefox/123 on Windows'
    ];
    const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];

    const ctx = await b.newContext({
        viewport: { width: 1366 + widthJitter, height: 768 + heightJitter },
        userAgent: randomUA,
        locale,
        timezoneId,
        storageState: { cookies: [], origins: [] },   // Zero state
        extraHTTPHeaders: {
            'Accept-Language': 'en-US,en;q=0.9',
            'DNT': '1',
            'Sec-GPC': '1',
            'Upgrade-Insecure-Requests': '1',
        },
        serviceWorkers: 'block',                       // No caching
        permissions: ['geolocation'],
        geolocation: { latitude: lat, longitude: lng } // Spoofed coordinates
    });
    // ... anti-detection mouse movements ...
}
```

**Why fresh context per point:** If the same context were reused, Google could personalize results based on cookies/history from the previous grid point. Fresh context = independent, location-specific results.

### Retry Logic

```typescript
// src/lib/scanner.ts:277-312
let attempts = 0;
const maxAttempts = 3;

while (!success && attempts < maxAttempts) {
    attempts++;
    try {
        const fresh = await createFreshContext(browser, point.lat, point.lng);
        results = await scrapeGMB(fresh.page, scan.keyword, point.lat, point.lng);
        success = true;
    } catch (scrapeError) {
        if (attempts < maxAttempts) {
            const isProxyError = scrapeError.message.includes('ERR_PROXY_CONNECTION_FAILED')
                || scrapeError.message.includes('ERR_TUNNEL_CONNECTION_FAILED')
                || scrapeError.message.includes('TIMEOUT');
            if (isProxyError) {
                // Close browser entirely and relaunch with different proxy
                browser.close();
                browser = await launchBrowser(currentProxyId);
            }
        }
    } finally {
        pointContext.close();  // ALWAYS close context
    }
}
```

**Retry behavior:**
- Attempt 1: Normal scrape
- Attempt 2: If proxy error → rotate proxy and retry. If other error → retry same proxy.
- Attempt 3: Last chance, same logic
- If all 3 fail: Store empty results for this point and continue to next point

### Inter-Point Delay

```typescript
// src/lib/scanner.ts:369
await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000));
```

2-5 second random delay between grid points. This is anti-detection throttling — scraping 25 grid points without delay would look suspicious.

---

## Logging & Observability

> **Source files:**
> - `src/lib/logger.ts` — Dual logger (console + SQLite)
> - `src/components/settings/Telemetry.tsx` — Log viewer UI
> - `src/app/api/logs/route.ts` — Log retrieval/deletion API

### Logger Infrastructure

The application has a single logger module that writes every log message to **two destinations simultaneously**:

```typescript
// src/lib/logger.ts
export async function logSystem(message: string, options: LogOptions = {}) {
    const { level = 'INFO', source = 'SYSTEM', details = null } = options;

    // 1. Immediate console output (visible in terminal running `npm run dev`)
    console.log(`[${level}] [${source}] ${message}`);

    // 2. Persistent storage in SQLite (visible in Settings > Telemetry UI)
    await prisma.systemLog.create({
        data: {
            level,      // INFO | WARN | ERROR | DEBUG
            message,    // Human-readable string
            source,     // SCANNER | PROXY_FETCHER | API | REVIEW_SCRAPER | SYSTEM
            details     // Optional JSON string for structured data
        }
    });
}

export const logger = {
    info:  (msg, source?, details?) => logSystem(msg, { level: 'INFO',  source, details }),
    warn:  (msg, source?, details?) => logSystem(msg, { level: 'WARN',  source, details }),
    error: (msg, source?, details?) => logSystem(msg, { level: 'ERROR', source, details }),
    debug: (msg, source?, details?) => logSystem(msg, { level: 'DEBUG', source, details }),
};
```

### Viewing Logs

**Terminal:** All logs appear in the process running `npm run dev` as `[LEVEL] [SOURCE] message`.

**UI:** Settings page > Telemetry tab. Features:
- Dark terminal-style log table, polls `/api/logs?limit=100` every 10 seconds
- Filter dropdowns for level (INFO/WARN/ERROR/DEBUG) and source (SCANNER/PROXY_FETCHER/API/SYSTEM)
- Color-coded rows: ERROR=red, WARN=amber, INFO=blue, DEBUG=gray
- Expandable detail payloads ("Inspect Payload" for logs with JSON details)
- Refresh and Clear All buttons

**API:** `GET /api/logs?limit=50&level=DEBUG&source=SCANNER` for programmatic access.

### What the Scraper Currently Logs

Every `scrapeGMB()` call produces these log messages (in order):

```
[DEBUG] [SCANNER] [Scraper] Navigating to Google Maps for "pizza" at 40.758,-73.985
```
Then one of:
```
[DEBUG] [SCANNER] Consent dialog detected in scraper. Clicking accept...
```
or nothing (consent not found, silently skipped).

Then one of:
```
[DEBUG] [SCANNER] [Scraper] API extraction found 20 businesses     ← API path succeeded
```
or:
```
console.log: [Scraper] API extraction failed, falling back to DOM  ← API path failed (NOT in DB!)
[DEBUG] [SCANNER] [Scraper] Using DOM fallback extraction...
[DEBUG] [SCANNER] [Scraper] Extracted 18 entities.                 ← DOM path result count
```

On error:
```
console.error: [Scraper] Page goto failed: net::ERR_PROXY_CONNECTION_FAILED  ← NOT in DB!
console.error: [Scraper] Error scraping 40.758,-73.985: <error>              ← NOT in DB!
```

### What the Scanner Logs (Around the Scraper)

```
[INFO]  [SCANNER] [Launcher] Initializing scanner process...
[INFO]  [SCANNER] [Launcher] Status set to RUNNING for keyword: "pizza"
[DEBUG] [SCANNER] [Launcher] Generated 25 coordinates for scan.
[DEBUG] [SCANNER] Launching browser...
[DEBUG] [SCANNER] Captured point 40.758,-73.985. Target Rank: 3 (20 results)
[DEBUG] [SCANNER] [Accuracy] Point 40.758,-73.985: only 8 results found (expected ~20)
[WARN]  [SCANNER] Attempt 1 failed for point 40.758,-73.985: <error message>
[WARN]  [SCANNER] Point capture failed: 40.758, -73.985 after max attempts.
[INFO]  [SCANNER] Scan sequence completed successfully for "pizza"
[ERROR] [SCANNER] Critical failure in scan: <error message>
```

### Logging Gaps — What Is NOT Observable

The following table shows all the blind spots in the current logging. These are areas where you have **zero visibility** into what's happening:

| What You Can't See | Why It Matters | Current Behavior |
|---------------------|----------------|-----------------|
| HTTP requests the browser sends to Google | Can't tell if the request URL, headers, or cookies are correct | Silent |
| HTTP response status codes from Google | Can't distinguish 200 (success) vs 302 (redirect) vs 429 (rate limit) vs 503 (block) | Silent |
| Response headers from Google | Can't detect captcha redirects, cookie requirements, or geo-blocking headers | Silent |
| Whether `APP_INITIALIZATION_STATE` exists on the page | Can't tell if API extraction failed because the variable was absent vs. data was malformed | Caught by generic try/catch, logged as `console.log` (not in DB) |
| The raw `APP_INITIALIZATION_STATE` structure | Can't inspect what Google actually returned to debug index mapping issues | Never captured |
| How many arrays the recursive traversal inspected vs. matched as entities | Can't tell if entity recognition heuristic is too strict or too loose | Silent |
| Which specific fields failed to extract per business (address miss, phone miss, etc.) | Can't identify which data indices have shifted | Silent |
| The page's final URL after redirects | Can't detect single-business page redirects or captcha redirects | Silent |
| Browser console errors/warnings | Can't see JavaScript errors on the Google Maps page that might indicate problems | Not captured |
| Page screenshots | Can't visually verify what the browser actually rendered | Not captured |
| Full HTML of the page | Can't post-mortem analyze what Google served | Not captured |
| Scroll progress (how many results loaded per scroll iteration) | Can't tell if scrolling is working or stalling | Silent |
| Which extraction path was used per scan point | Only visible if you correlate "API extraction found N" vs "Using DOM fallback" messages | Partially logged |
| HAR (HTTP Archive) network trace | Can't replay or inspect the full network conversation | Not available |

### Critical: Some Errors Use `console.log`/`console.error` Instead of `logger`

Several important error messages bypass the database logger and only appear in the terminal:

```typescript
// These go to console ONLY — not saved in DB, not visible in Telemetry UI:
console.error(`[Scraper] Page goto failed: ${gotoError.message}`);           // scraper.ts:43
console.log('[Scraper] Warning: Standard result selectors not found...');     // scraper.ts:68
console.log('[Scraper] API extraction failed, falling back to DOM:', err);    // scraper.ts:134
console.error(`[Scraper] Error scraping ${lat},${lng}:`, error);             // scraper.ts:377
console.error('[Scanner] Failed to update proxy status:', err);               // scanner.ts:142
```

If you're only checking the Telemetry UI, you'll miss these. They only appear in the terminal process.

### TODO: Network-Level Request/Response Logging

> **Status: NOT IMPLEMENTED**

Playwright supports full network interception via `page.on('request')` and `page.on('response')` events. This would allow logging:
- Every HTTP request URL, method, and headers the browser sends
- Every HTTP response status code, headers, and timing
- Detection of redirects, captchas, and rate limiting

```typescript
// Example of what could be added to scrapeGMB():
page.on('request', req => {
    logger.debug(`[Network] → ${req.method()} ${req.url()}`, 'SCANNER');
});
page.on('response', res => {
    logger.debug(`[Network] ← ${res.status()} ${res.url()}`, 'SCANNER');
});
```

### TODO: APP_INITIALIZATION_STATE Presence/Structure Logging

> **Status: NOT IMPLEMENTED**

After page load, the scraper should log whether `APP_INITIALIZATION_STATE` exists and its basic structure before attempting extraction:

```typescript
// Example of what could be added to extractFromAPIData():
const appState = window.APP_INITIALIZATION_STATE;
if (!appState) {
    logger.warn('[Scraper] APP_INITIALIZATION_STATE not found on page', 'SCANNER');
    return null;
}
logger.debug(`[Scraper] APP_INITIALIZATION_STATE found, keys: ${Object.keys(appState)}`, 'SCANNER');
logger.debug(`[Scraper] appState[3] type: ${typeof appState[3]}, has 'ug': ${!!appState[3]?.ug}`, 'SCANNER');
```

### TODO: Per-Entity Extraction Diagnostics

> **Status: NOT IMPLEMENTED**

Track which fields successfully extracted vs. failed for each business entity. This would immediately reveal when Google shifts data indices:

```typescript
// Example: after extracting each business
const diagnostics = {
    name: !!name,
    cid: !!cid,
    placeId: !!placeId,
    address: !!address,
    phone: !!phone,
    website: !!website,
    rating: rating > 0,
    reviews: reviews > 0,
    categories: categories.length > 0,
    addressSource: address === safeGet(biz, 18) ? 'index18' :
                   address === safeGet(biz, 39) ? 'index39' : 'deepSearch'
};
logger.debug(`[Scraper] Entity "${name}": ${JSON.stringify(diagnostics)}`, 'SCANNER');
```

### TODO: Screenshot Capture on Failure

> **Status: NOT IMPLEMENTED**

When extraction returns 0 results or fewer than expected, capture a screenshot for post-mortem analysis:

```typescript
// Example:
if (results.length === 0) {
    const screenshot = await page.screenshot({ fullPage: true });
    // Save to filesystem or encode as base64 in log details
    logger.warn('[Scraper] Zero results — screenshot captured', 'SCANNER', {
        screenshot: screenshot.toString('base64').substring(0, 500) + '...',
        url: page.url(),
        title: await page.title()
    });
}
```

### TODO: HAR File Recording

> **Status: NOT IMPLEMENTED**

Playwright natively supports HAR recording — a complete capture of all network traffic that can be opened in browser DevTools for replay and inspection:

```typescript
// Example: enable per-context HAR recording
const ctx = await browser.newContext({
    recordHar: {
        path: `/tmp/georanker-har/${scanId}-${pointIndex}.har`,
        mode: 'minimal'  // or 'full' for response bodies
    }
});
// ... scrape ...
await ctx.close();  // HAR file is written on context close
```

### TODO: Browser Console Log Capture

> **Status: NOT IMPLEMENTED**

Capture JavaScript console messages from the Google Maps page. These can reveal rendering errors, API failures, or deprecation warnings:

```typescript
// Example:
page.on('console', msg => {
    if (msg.type() === 'error') {
        logger.debug(`[BrowserConsole] ${msg.text()}`, 'SCANNER');
    }
});
```

### TODO: Page URL and Redirect Tracking

> **Status: NOT IMPLEMENTED**

After navigation completes, log the actual URL the browser landed on. This reveals captcha redirects, single-business page redirects, and consent page redirects:

```typescript
// Example:
const finalUrl = page.url();
if (!finalUrl.includes('/maps/search/')) {
    logger.warn(`[Scraper] Unexpected redirect: navigated to ${finalUrl}`, 'SCANNER');
}
```

### TODO: Scroll Progress Logging

> **Status: NOT IMPLEMENTED**

Log how many results are loaded at each scroll iteration. This would reveal stalled scrolling, blocked lazy-loading, or unexpected result counts:

```typescript
// Example: inside the scroll loop
logger.debug(`[Scraper] Scroll ${i+1}/${maxScrollIterations}: ${currentCount} results loaded (prev: ${previousCount}, streak: ${noNewResultsStreak})`, 'SCANNER');
```

---

## Improvement Opportunities

### Critical Issues

#### 1. `apiParser.ts` is Dead Code
The standalone parser module (`src/lib/apiParser.ts`, 606 lines) is **not imported anywhere**. The scraper uses its own inline `extractFromAPIData()`. This creates two problems:
- 606 lines of unmaintained dead code
- Improvements made to one version don't propagate to the other

**Options:**
- Delete `apiParser.ts` entirely
- Refactor `scraper.ts` to import from `apiParser.ts` instead of inlining the logic
- Merge the best parts of both into a single module

#### 2. `attributes` and `hours` Fields Are Never Populated
The `ScrapeResult` interface declares `attributes?: string[]` and `hours?: string` but neither extraction path populates them. Code that reads these fields will always get `undefined`.

**Options:**
- Remove them from the interface
- Implement extraction (both are available in the API data — hours at various indices, attributes at index 34 or similar)

#### 3. Asymmetric Field Coverage Between Extraction Paths
Some fields are only available in one extraction path:

| Field | API Path | DOM Path |
|-------|----------|----------|
| `photosCount` | Yes | No |
| `businessProfileId` | Yes | No |
| `yearsInBusiness` | No | Yes |
| `openNow` | No | Yes |

This means the same scan can produce different data quality depending on which extraction path succeeds. Downstream code (analysis, export) can't reliably depend on these fields.

**Fix:** Add `yearsInBusiness` and `openNow` extraction to the API path (the data exists in `APP_INITIALIZATION_STATE`). Add `photosCount` extraction to the DOM path.

### Reliability

#### 4. Fragile CSS Selectors
`.qBF1Pd` and `.fontHeadlineSmall` are Google-internal class names that can change without notice. When they change, name extraction in the DOM path silently fails. The `[role="heading"]` selector is more stable but less specific.

**Improvement:** Add a monitoring mechanism — log when DOM extraction produces significantly fewer results than expected, which may indicate selector breakage.

#### 5. Hardcoded Data Indices
All API extraction relies on fixed array indices (`11` = name, `9` = coordinates, etc.). Google can rearrange these indices at any time. When they do, the API extraction silently returns wrong data or nothing.

**Improvement:** Add validation checks after extraction — e.g., verify that the extracted "name" looks like a business name (not a URL or number), that "rating" is between 0 and 5, that "coordinates" are valid lat/lng ranges.

#### 6. Consent Dialog Language Coverage
Only 3 languages (English, German, Arabic) have explicit selectors. The generic `form[action*="consent"]` fallback is unreliable.

**Improvement:** Add French (`"Tout accepter"`), Spanish (`"Aceptar todo"`), Italian (`"Accetta tutto"`), Dutch (`"Alles accepteren"`), Portuguese (`"Aceitar tudo"`), Polish (`"Zaakceptuj wszystko"`) at minimum.

#### 7. No Captcha Detection
The scraper doesn't explicitly check for or handle captchas/bot detection pages. If Google serves a captcha, the scraper will extract 0 results and either the DOM path returns an empty array or the API path returns no entities.

**Improvement:** Detect captcha pages (check for `recaptcha` iframes, specific URL patterns, or "unusual traffic" text) and report them explicitly rather than silently returning empty results.

### Performance

#### 8. Scroll Wait Time Is Conservative
The `800 + Math.random() * 1200` delay (0.8-2.0s per scroll) means scrolling alone takes 5-12+ seconds. With the 20s selector wait and 30s navigation timeout, a single grid point can take 30-60+ seconds.

For a 7x7 grid (49 points) with 2-5s inter-point delay, total scan time is:
```
49 points × (~15s scrape + ~3.5s delay) = ~15 minutes best case
49 points × (~40s scrape + ~3.5s delay) = ~35 minutes worst case
```

**Improvement:** Consider reducing the scroll delay for subsequent scrolls after the first one confirms results are loading quickly. Adaptive delay: if the first scroll loads results within 300ms, reduce subsequent delays to 500ms.

#### 9. No Request Interception
The scraper loads the full Google Maps page including all JavaScript, CSS, images, fonts, and third-party trackers. Much of this is unnecessary for data extraction.

**Improvement:** Use Playwright's `route()` to block unnecessary resources:
```typescript
await page.route('**/*.{png,jpg,gif,svg,woff,woff2}', route => route.abort());
await page.route('**/maps.googleapis.com/maps/api/js/**', route => route.abort());
```
This could reduce page load time by 30-50%.

#### 10. Full Page Load Before API Extraction
The scraper scrolls the results feed (which modifies the DOM) before attempting API extraction. But `APP_INITIALIZATION_STATE` is available immediately after page load — it doesn't depend on scrolling.

**Improvement:** Try API extraction right after `domcontentloaded`, before scrolling. If it succeeds (≥20 results), skip scrolling entirely. Only scroll if API extraction fails and DOM extraction is needed.

### Data Quality

#### 11. No Result Count Validation
The scraper returns whatever it finds — even 0 or 1 results. The scanner logs a debug message if fewer than 20 results are found, but no action is taken.

**Improvement:** If the API path returns fewer than 5 results, try the DOM path as well and merge/deduplicate. This could recover from partial API extraction failures.

#### 12. Address Deep Search Can Match Non-Addresses
The recursive address deep search (depth 8, entire object) accepts any string with digits + comma/street-word. In edge cases, this could match:
- Business descriptions containing addresses
- Nearby landmark text
- Directions text

**Improvement:** Score address candidates by how "address-like" they look (number of address features present) rather than accepting the first match.

#### 13. End-of-List Detection Is English-Only
The scroll stopping condition checks for English text:
```typescript
text.includes('end of the list') || text.includes('No more results')
```

With `hl=en` in the URL this usually works, but if Google's response language doesn't match, these strings won't be found and the scraper will rely on the stale-count fallback (3 no-new-result scrolls).

**Improvement:** Add translations or use a language-agnostic signal (e.g., presence of a specific CSS class at the end of the feed).

#### 14. No Handling of Single-Business Pages
If the Google Maps URL redirects to a single business page (instead of search results), the scraper will fail to find articles or feed elements and return 0 results. This happens when the keyword is very specific (e.g., an exact business name).

**Improvement:** Detect single-business pages and extract the single result. Check for patterns like the presence of a reviews section or a `place/` URL without a search feed.
