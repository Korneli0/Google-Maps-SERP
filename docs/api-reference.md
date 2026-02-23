# API Reference

> All Next.js App Router API routes under `src/app/api/`. All routes return JSON unless noted otherwise.

## Scans

### `GET /api/scans`

List all scans.

**Response:** `{ scans: Scan[] }` — ordered by `createdAt` DESC.

---

### `POST /api/scans`

Create a new scan and start background execution.

**Request Body:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `keyword` | string | required | Search keyword |
| `lat` | number | 41.8781 | Center latitude |
| `lng` | number | -87.6298 | Center longitude |
| `radius` | number | 5 | Radius in km |
| `gridSize` | number | 3 | Grid dimension (NxN) |
| `shape` | string | `"SQUARE"` | `SQUARE`, `CIRCLE`, `ZIP`, `SMART` |
| `frequency` | string | `"ONCE"` | `ONCE`, `DAILY`, `WEEKLY` |
| `businessName` | string | — | Business to track (optional) |
| `placeId` | string | — | Google Place ID for precise tracking |
| `customPoints` | GeoPoint[] | — | Manual coordinates (overrides grid generation) |

**Response:** Created `Scan` object.

**Side effect:** Fires `runScan(scanId)` as a background promise.

---

### `GET /api/scans/[id]`

Get scan with all results.

**Response:** `{ scan: Scan & { results: Result[] } }`

**Status codes:** 404 if not found.

---

### `PATCH /api/scans/[id]`

Update scan fields. Whitelisted fields only.

**Allowed fields:** `keyword`, `businessName`, `radius`, `frequency`, `gridSize`, `shape`

**Response:** Updated `Scan` object.

**Status codes:** 400 if no valid fields provided.

---

### `DELETE /api/scans/[id]`

Delete scan and cascade to all results.

**Response:** `{ success: true }`

---

### `POST /api/scans/[id]/rerun`

Clear results, reset status, and re-execute scan.

**Side effects:**
1. Delete all Results for this scan
2. Delete all Alerts for this scan
3. Reset status → `PENDING`, clear `nextRun`
4. Fire `runScan(scanId)` in background

**Response:** `{ success: true, scan: Scan & { results } }`

**Status codes:** 404 if not found.

---

### `POST /api/scans/[id]/stop`

Stop a running scan. The scanner checks status before each grid point and exits if `STOPPED`.

**Response:** `{ success: true, scan: Scan & { results } }`

---

### `GET /api/scans/history`

Historical ranking trend for a keyword + business combination.

**Query params:**

| Param | Type | Required |
|-------|------|----------|
| `keyword` | string | Yes |
| `businessName` | string | Yes |

**Response:**

```json
{
  "history": [
    { "date": "ISO string", "avgRank": 3.5, "top3Count": 12, "scanId": "..." }
  ]
}
```

Only includes `COMPLETED` scans. Computes rolling avgRank and top-3 count from results.

**Status codes:** 400 if params missing.

---

### `POST /api/scans/lookup`

Resolve business details from a Google Maps URL or search query. Uses Playwright.

**Request Body:**

| Field | Type | Description |
|-------|------|-------------|
| `url` | string | Google Maps URL (direct navigation) |
| `query` | string | Search query (returns top 5) |

One of `url` or `query` required.

**Response (URL mode):**

```json
{
  "business": {
    "name": "Business Name",
    "address": "123 Main St",
    "lat": 40.758,
    "lng": -73.985,
    "url": "https://...",
    "placeId": "ChIJ..."
  }
}
```

**Response (search mode):**

```json
{
  "results": [
    { "name": "...", "address": "...", "url": "...", "placeId": "..." }
  ]
}
```

**Status codes:** 400 if neither query nor url provided.

---

## Reviews

### `GET /api/reviews`

List all review analyses (without individual reviews).

**Response:** `ReviewAnalysis[]` — ordered by `createdAt` DESC.

---

### `POST /api/reviews`

Start a review scrape + analysis. Returns SSE stream.

**Request Body:**

| Field | Type | Required |
|-------|------|----------|
| `url` | string | Yes |
| `businessName` | string | No |
| `totalReviews` | number | No |
| `averageRating` | number | No |
| `placeId` | string | No |

**Response:** `Content-Type: text/event-stream`

SSE event format:
```
data: {"msg":"Loaded 50/200 reviews...","type":"info"}

data: {"result":{...},"type":"complete"}
```

**Process:**
1. Create ReviewAnalysis (status: SCRAPING)
2. Scrape reviews via Playwright with SSE progress
3. Save reviews in 100-review chunks
4. Status → ANALYZING
5. Enrich with sentiment + fake scores
6. Compute 150+ metrics via `analyzeReviews()`
7. Status → COMPLETED

---

### `GET /api/reviews/[id]`

Get full analysis with all reviews.

**Response:** `ReviewAnalysis & { reviews: Review[] }` — reviews sorted by rating ASC.

**Status codes:** 404 if not found.

---

### `DELETE /api/reviews/[id]`

Delete analysis and all associated reviews (cascade).

**Response:** `{ success: true }`

---

### `POST /api/reviews/preview`

Quick business info extraction without full review scrape.

**Request Body:** `{ url: string }`

**Response:**

```json
{
  "name": "Business Name",
  "averageRating": 4.5,
  "totalReviews": 1234,
  "placeId": "ChIJ...",
  "address": "123 Main St",
  "category": "Restaurant"
}
```

Uses Playwright. Multiple fallback selectors for rating/review extraction.

---

## Dashboard

### `GET /api/dashboard`

Aggregate statistics for the dashboard page.

**Response:**

```json
{
  "scansCount": 42,
  "completedScans": 38,
  "activeScans": 2,
  "recentScans": [/* 5 most recent scans */]
}
```

---

## Proxies

### `GET /api/proxies`

List all proxies.

**Response:** `{ proxies: Proxy[] }` — ordered by `createdAt` DESC.

---

### `POST /api/proxies`

Add a proxy to the pool.

**Request Body:**

| Field | Type | Default | Required |
|-------|------|---------|----------|
| `host` | string | — | Yes |
| `port` | number | — | Yes |
| `username` | string | — | No |
| `password` | string | — | No |
| `type` | string | `"RESIDENTIAL"` | No |
| `enabled` | boolean | `true` | No |

**Status codes:** 400 if host/port missing, 409 if duplicate host:port.

---

### `PUT /api/proxies`

Update a proxy.

**Request Body:** `{ id: string, ...fields }`

---

### `DELETE /api/proxies`

Delete proxies.

**Query params:** `id` — proxy ID, or `"all"` to purge entire pool.

---

### `PATCH /api/proxies`

Validate proxy health.

**Request Body:** `{ action: "VALIDATE_ALL" }`

Tests top 100 enabled proxies (concurrency: 20). Updates status to `ACTIVE` or `DEAD`.

**Response:**

```json
{
  "success": true,
  "tested": 50,
  "active": 35,
  "dead": 15
}
```

---

### `POST /api/proxies/fetch`

Auto-fetch proxies from public GitHub repositories.

**Sources:** TheSpeedX, ShiftyTR, Monosans, ProxyListPlus (8s timeout each).

**Safety:** Aborts if any scan is currently RUNNING.

**Process:**
1. Fetch from 4 sources
2. Deduplicate and parse `host:port` format
3. Validate top 100 via `validateProxyBatch()`
4. Filter out existing proxies (manual dedup for SQLite)
5. Insert new proxies one-by-one

**Response:**

```json
{
  "success": true,
  "sources": ["TheSpeedX", "ShiftyTR"],
  "logs": ["Fetched 500 from TheSpeedX", ...],
  "count": 45
}
```

---

## Geocoding

### `GET /api/geocode`

Geocode an address string to coordinates.

**Query params:** `address` (required)

**Response:**

```json
{
  "lat": 40.758,
  "lng": -73.985,
  "display_name": "Times Square, Manhattan, New York, NY, USA"
}
```

**Provider:** Nominatim (OpenStreetMap). User-Agent: `GeoRanker/1.0`.

**Status codes:** 400 if no address, 404 if not found.

---

### `GET /api/geocode/city`

Get neighborhood or postal code points within a city boundary.

**Query params:**

| Param | Type | Required |
|-------|------|----------|
| `city` | string | Yes |
| `state` | string | No |
| `country` | string | No |
| `type` | string | Yes (`zip` or `neighborhood`) |

**Process:**
1. Geocode city via Nominatim (get OSM ID)
2. Query Overpass API for postal codes or neighborhoods/suburbs within boundary
3. Return center points

**Response:**

```json
{
  "points": [
    { "lat": 40.758, "lng": -73.985, "name": "10036", "id": "zip-10036" }
  ],
  "cityMeta": { "name": "New York", "lat": 40.71, "lng": -74.0 }
}
```

---

## Locations

### `GET /api/locations/autocomplete`

Location autocomplete for country/state/city selection.

**Query params:**

| Param | Type | Default |
|-------|------|---------|
| `q` | string | — |
| `type` | string | `"city"` |
| `countryCode` | string | — |
| `stateCode` | string | — |

**Provider:** `country-state-city` library (offline data).

**Response varies by type:**
- **country:** `[{ label, value: isoCode, emoji: flag }]`
- **state:** `[{ label, value: isoCode }]` — requires `countryCode`
- **city:** `[{ label, value: name, lat, lng }]` — requires `countryCode` + `stateCode`

---

## Alerts

### `GET /api/alerts`

Get latest 20 alerts.

**Response:** `{ alerts: Alert[] }` — ordered by `createdAt` DESC.

---

### `POST /api/alerts`

Mark alert as read/unread.

**Request Body:** `{ id: string, read: boolean }`

---

### `DELETE /api/alerts`

Delete an alert.

**Request Body:** `{ id: string }`

---

## Settings

### `GET /api/settings`

Get all settings as key-value map.

**Response:** `{ settings: Record<string, string> }`

---

### `POST /api/settings`

Upsert a setting.

**Request Body:** `{ key: string, value: any }` — value is coerced to string.

---

## System Logs

### `GET /api/logs`

Get filtered system logs.

**Query params:**

| Param | Type | Default |
|-------|------|---------|
| `limit` | number | 50 |
| `level` | string | — |
| `source` | string | — |

**Response:** `{ logs: SystemLog[] }` — ordered by `createdAt` DESC.

---

### `DELETE /api/logs`

Clear all system logs.

---

## System

### `GET /api/system/lookback`

Find recurring scans that missed their scheduled run.

**Response:** `{ missedScans: Scan[] }` — scans where `nextRun < now` and `frequency != ONCE`.

---

### `POST /api/system/lookback`

Execute missed scans.

**Request Body:** `{ scanIds: string[] }`

Triggers `runScan()` for each scan in background.

**Response:** `{ success: true, count: number }`
