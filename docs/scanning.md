# Scan Engine

> `src/lib/scanner.ts` — Orchestrates the entire scan lifecycle: grid iteration, browser management, business matching, and alert generation.

## Entry Point

```typescript
export async function runScan(scanId: string): Promise<void>
```

Called as a detached background promise from `POST /api/scans`. No queue, no worker — just `runScan(scanId).catch(...)`.

## Lifecycle

```
runScan(scanId)
  │
  ├─ 1. Load scan config from DB
  ├─ 2. Set status → RUNNING
  ├─ 3. Generate grid points (or use customPoints JSON)
  ├─ 4. Read proxy settings (GlobalSetting key=useSystemProxy)
  ├─ 5. Launch browser (with proxy if configured)
  │
  ├─ 6. For each GridPoint:
  │     ├─ Check scan status (exit if STOPPED or PENDING)
  │     ├─ Create fresh browser context (zero-state)
  │     ├─ Call scrapeGMB(page, keyword, lat, lng)
  │     ├─ Match target business → extract rank
  │     ├─ Save Result to DB
  │     ├─ Close context
  │     └─ Random delay 2–5 seconds
  │
  ├─ 7. Calculate nextRun (DAILY: +24h, WEEKLY: +7d)
  ├─ 8. Compare with previous scan → create alerts
  └─ 9. Set status → COMPLETED
```

## Regional Settings

`getRegionalSettings(lat, lng)` derives locale and timezone from coordinates to ensure localized Google Maps results while keeping English language.

| Region | Coordinates | Locale | Timezone |
|--------|------------|--------|----------|
| USA | 24–50°N, 125–66°W | `en-US` | `America/New_York` / `Chicago` / `Denver` / `Los_Angeles` (by longitude) |
| UK | 49–61°N, 11°W–2°E | `en-GB` | `Europe/London` |
| Europe | 35–72°N, 10°W–40°E | `en-FR` | `Europe/Paris` or `Europe/Berlin` (>20°E) |
| Australia | 48–10°S, 110–155°E | `en-AU` | `Australia/Sydney` |
| India | 8–37°N, 68–98°E | `en-IN` | `Asia/Kolkata` |
| Middle East | 12–35°N, 34–60°E | `en-AE` | `Asia/Dubai` |
| Canada | 42–83°N, 141–52°W | `en-CA` | `America/Toronto` or `America/Vancouver` (<-110°W) |
| Default | everywhere else | `en-US` | `UTC` |

## Business Name Matching

### `normalizeBusinessName(name: string): string`

Pipeline:
1. Lowercase
2. Normalize smart quotes (`''` → `'`)
3. Strip punctuation except apostrophes: `/[^a-z0-9'\s]/g` → space
4. Remove suffixes/articles: `llc`, `inc`, `corp`, `ltd`, `co`, `the`, `and`, `of`
5. Collapse whitespace
6. Trim

Example: `"McDonald's, Inc."` → `"mcdonald's"`

### `businessNamesMatch(scanName, resultName): boolean`

Three-tier matching:

| Tier | Logic | Example |
|------|-------|---------|
| 1. Exact | Normalized names identical | `"mcdonald's"` = `"mcdonald's"` |
| 2. Containment | One contains the other | `"burger king"` ⊂ `"burger king restaurant"` |
| 3. Token overlap | ≥80% of scan tokens appear in result | `"smith law firm"` matches `"smith law firm llc"` (3/3 = 100%) |

Token overlap formula: `matchCount / scanTokens.length >= 0.8` (tokens with length > 1).

### Matching Priority in Scan Loop

1. **Place ID match** (exact) — if `scan.placeId` is set, find result where `placeId` or `cid` matches
2. **Fuzzy name match** (fallback) — if only `businessName` is set, use `businessNamesMatch()`

If Place ID matches but `businessName` is not set, the scanner auto-corrects it from the matched result.

## Browser Context Creation

`createFreshContext(browser, lat, lng)` — creates an isolated browser context per grid point. This is the key accuracy mechanism: each point gets a clean browser with no cookies, cache, or history, preventing Google from personalizing results based on prior searches.

### Context Configuration

| Setting | Value | Purpose |
|---------|-------|---------|
| Viewport | 1366±50 × 768±50 px | Random jitter reduces fingerprinting |
| User Agent | Rotated across 4 configs | Mac Chrome, Windows Chrome, Mac Safari, Firefox |
| Locale | From `getRegionalSettings()` | Matches scan region |
| Timezone | From `getRegionalSettings()` | Matches scan region |
| Storage State | `{ cookies: [], origins: [] }` | Zero state |
| HTTP Headers | `Accept-Language: en-US`, `DNT: 1`, `Sec-GPC: 1` | Privacy signals |
| Service Workers | Blocked | Prevents caching |
| Geolocation | `{ latitude: lat, longitude: lng }` | Spoofed to grid point |

### Anti-Detection

After page creation, injects a script that dispatches random `mousemove` events every 1 second to simulate human interaction.

## Proxy Management

### `launchBrowser(failedProxyId?)`

1. If `failedProxyId` provided → mark that proxy `DEAD` in DB
2. If `useSystemProxy = false`:
   - Fetch all enabled proxies with status `ACTIVE` or `UNTESTED`
   - Prefer `ACTIVE` proxies; fall back to `UNTESTED`
   - Pick one randomly → set as `proxy.server` in Playwright launch options
3. If proxy launch fails → mark proxy `DEAD` → retry without proxy (direct connection)

### Proxy Error Detection in Scan Loop

When scraping fails, the error message is checked for:
- `ERR_PROXY_CONNECTION_FAILED`
- `ERR_TUNNEL_CONNECTION_FAILED`
- `TIMEOUT`

If proxy error → close browser → relaunch with different proxy via `launchBrowser(currentProxyId)`.

## Retry Logic

Each grid point gets up to **3 attempts**:
- Attempt 1: Normal scrape
- Attempt 2: If proxy error → relaunch browser with new proxy. Otherwise → retry with same browser
- Attempt 3: Same as attempt 2

If all 3 fail → save empty Result (`rank: null`, `topResults: []`) and continue to next point.

Context is always closed in `finally` block regardless of success/failure.

## Concurrency Safety

Before processing each grid point, the scanner re-reads the scan's status from DB:

```typescript
const currentScan = await prisma.scan.findUnique({
    where: { id: scanId },
    select: { status: true }
});
if (!currentScan || currentScan.status === 'STOPPED' || currentScan.status === 'PENDING') {
    break; // Exit loop
}
```

- `STOPPED`: User clicked stop → exit cleanly
- `PENDING`: A rerun was triggered → another `runScan()` process was started, this old one must exit to avoid data corruption
- Deleted: Scan no longer exists → exit

## Alert Generation

After completing all grid points, if `businessName` is set:

1. Find the most recent `COMPLETED` scan with the same keyword + business
2. Calculate average rank for both scans (only points where `rank !== null`)
3. If `|previousAvg - currentAvg| >= 0.5`:
   - `diff > 0` → `RANK_UP` alert
   - `diff < 0` → `RANK_DOWN` alert

The alert creation and status update use a Prisma `$transaction` for atomicity.

## Recurring Scans

After completion, `nextRun` is calculated:
- `DAILY`: `Date.now() + 24 * 60 * 60 * 1000`
- `WEEKLY`: `Date.now() + 7 * 24 * 60 * 60 * 1000`
- `ONCE`: `null`

The `/api/system/lookback` endpoint checks for missed scheduled scans (where `nextRun < now()`).

## Error Handling

| Scenario | Action |
|----------|--------|
| Scan not found in DB | Log error, return early |
| Proxy launch failure | Mark proxy DEAD, retry without proxy |
| Scrape failure (proxy error) | Relaunch browser with new proxy, retry point |
| Scrape failure (other) | Retry point with same browser |
| All attempts exhausted for point | Save empty Result, continue |
| Critical unhandled error | Set status → FAILED, create SCAN_ERROR alert |
| Browser cleanup | Always close in `finally` block |
