# Database

> SQLite via Prisma 5. Schema: `prisma/schema.prisma`. Database file: `prisma/dev.db`.

## Configuration

```prisma
datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")   // "file:./dev.db"
}
```

Single environment variable: `DATABASE_URL="file:./dev.db"`.

## Models

### Scan

Core scan configuration and execution record.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | String | `cuid()` | Primary key |
| `keyword` | String | — | Search keyword |
| `createdAt` | DateTime | `now()` | Creation timestamp |
| `status` | String | `"PENDING"` | `PENDING`, `RUNNING`, `COMPLETED`, `FAILED`, `STOPPED` |
| `centerLat` | Float | — | Grid center latitude |
| `centerLng` | Float | — | Grid center longitude |
| `radius` | Float | — | Scan radius in km |
| `gridSize` | Int | `3` | Grid dimension (e.g., 3 = 3x3) |
| `shape` | String | `"SQUARE"` | `SQUARE`, `CIRCLE`, `ZIP`, `SMART` |
| `customPoints` | String? | — | JSON string of manual GeoPoint[] |
| `frequency` | String | `"ONCE"` | `ONCE`, `DAILY`, `WEEKLY` |
| `nextRun` | DateTime? | — | Next scheduled execution time |
| `businessName` | String? | — | Target business name |
| `placeId` | String? | — | Google Place ID for precise matching |

**Relations:** `results Result[]`

**Indexes:** `status`, `createdAt`, `nextRun`

---

### Result

Individual grid point scan result.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | String | `cuid()` | Primary key |
| `scanId` | String | — | FK → Scan.id |
| `lat` | Float | — | Grid point latitude |
| `lng` | Float | — | Grid point longitude |
| `rank` | Int? | — | Target business rank (null if not found) |
| `targetName` | String? | — | Matched business name |
| `placeId` | String? | — | Matched business Place ID |
| `cid` | String? | — | Matched business CID |
| `topResults` | String | — | JSON string: top 20 businesses (ScrapeResult[]) |
| `capturedAt` | DateTime | `now()` | Capture timestamp |

**Relations:** `scan Scan` (onDelete: Cascade)

**Indexes:** `scanId`

#### topResults JSON Schema

```typescript
Array<{
    name: string;
    rating?: number;
    reviews?: number;
    address?: string;
    url?: string;
    rank: number;
    category?: string;
    isSAB?: boolean;
    phone?: string;
    website?: string;
    priceLevel?: string;
    cid?: string;
    placeId?: string;
    allCategories?: string[];
    openNow?: boolean;
    yearsInBusiness?: number;
    profileCompleteness?: number;
    businessProfileId?: string;
}>
```

---

### ReviewAnalysis

Review scraping metadata and analysis results.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | String | `cuid()` | Primary key |
| `businessName` | String | — | Business name |
| `businessUrl` | String | — | Google Maps URL |
| `placeId` | String? | — | Google Place ID |
| `totalReviews` | Int | `0` | Total reviews found |
| `averageRating` | Float | `0` | Average star rating |
| `analysisData` | String? | — | Full JSON blob of 150+ metrics (ReviewAnalysisResult) |
| `status` | String | `"PENDING"` | `PENDING`, `SCRAPING`, `ANALYZING`, `COMPLETED`, `FAILED` |
| `error` | String? | — | Error message if failed |
| `createdAt` | DateTime | `now()` | Creation timestamp |

**Relations:** `reviews Review[]`

**Indexes:** `status`, `createdAt`

#### analysisData JSON Schema

See [Review Intelligence](./review-intelligence.md) for the full `ReviewAnalysisResult` type with all 10 metric categories.

---

### Review

Individual review record.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | String | `cuid()` | Primary key |
| `analysisId` | String | — | FK → ReviewAnalysis.id |
| `reviewerName` | String | — | Reviewer display name |
| `reviewerUrl` | String? | — | Reviewer profile URL |
| `reviewImage` | String? | — | Review photo URL |
| `reviewCount` | Int? | — | Reviewer's total review count |
| `photoCount` | Int? | — | Reviewer's total photo count |
| `rating` | Int | — | Star rating (1-5) |
| `text` | String? | — | Review text |
| `publishedDate` | String? | — | Relative date ("2 months ago") |
| `responseText` | String? | — | Owner's response text |
| `responseDate` | String? | — | Owner's response date |
| `sentimentScore` | Float? | — | Sentiment score (-1 to +1 compound) |
| `sentimentLabel` | String? | — | `POSITIVE`, `NEGATIVE`, `NEUTRAL`, `MIXED` |
| `isLikelyFake` | Boolean | `false` | Flagged if fakeScore ≥ 50 |
| `fakeScore` | Float? | — | Fake probability score (0-100) |
| `analysisBlob` | String? | — | Additional analysis JSON |

**Relations:** `analysis ReviewAnalysis` (onDelete: Cascade)

**Indexes:** `analysisId`

---

### Proxy

Proxy pool entry.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | String | `cuid()` | Primary key |
| `host` | String | — | Proxy hostname/IP |
| `port` | Int | — | Proxy port |
| `username` | String? | — | Auth username |
| `password` | String? | — | Auth password |
| `type` | String | `"RESIDENTIAL"` | `RESIDENTIAL`, `DATACENTER` |
| `enabled` | Boolean | `true` | Whether proxy is active in pool |
| `status` | String | `"UNTESTED"` | `UNTESTED`, `ACTIVE`, `DEAD` |
| `lastTestedAt` | DateTime? | — | Last health check timestamp |
| `createdAt` | DateTime | `now()` | Creation timestamp |

**Unique constraint:** `[host, port]`

---

### Alert

Ranking change and error notifications.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | String | `cuid()` | Primary key |
| `type` | String | — | `RANK_UP`, `RANK_DOWN`, `SCAN_ERROR` |
| `message` | String | — | Human-readable message |
| `scanId` | String | — | Associated scan ID |
| `createdAt` | DateTime | `now()` | Creation timestamp |
| `read` | Boolean | `false` | Whether user has seen it |

**Indexes:** `read`, `scanId`

---

### GlobalSetting

Application configuration key-value store.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | String | `cuid()` | Primary key |
| `key` | String | — | Setting key (unique) |
| `value` | String | — | Setting value |

**Known keys:**
- `useSystemProxy` — `"true"` or `"false"`, controls whether scanner uses proxy pool

---

### SystemLog

Application telemetry and debugging.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | String | `cuid()` | Primary key |
| `level` | String | `"INFO"` | `INFO`, `WARN`, `ERROR`, `DEBUG` |
| `message` | String | — | Log message |
| `source` | String? | — | Module: `SCANNER`, `PROXY_FETCHER`, `API`, `REVIEW_SCRAPER` |
| `details` | String? | — | JSON string of extra context |
| `createdAt` | DateTime | `now()` | Timestamp |

---

## Relationships

```
Scan ──┬── Result[]     (cascade delete)
       └── Alert        (referenced by scanId, not FK)

ReviewAnalysis ── Review[]  (cascade delete)
```

Note: Alert references `scanId` but has no formal Prisma relation (no `@relation` decorator). Alerts must be deleted manually when deleting scans.

## Prisma Singleton

> `src/lib/prisma.ts`

```typescript
const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma || new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = prisma;
}
```

Prevents multiple PrismaClient instances during Next.js HMR in development. In production, creates a fresh client.

**Import:** `import { prisma } from '@/lib/prisma'`

**Exception:** The reviews POST API route creates a separate `new PrismaClient()` to avoid global caching issues with long-running SSE streaming responses.

## Migration Workflow

```bash
# After schema changes:
npx prisma generate                        # Regenerate client types
npx prisma migrate dev --name <name>       # Create + apply migration

# Dev utilities:
npx prisma studio                          # DB browser GUI
npx prisma db push                         # Push schema without migration file
```

## SQLite Limitations

- No `createMany` with `skipDuplicates` — manual dedup required (see proxy fetch)
- No native array types — stored as JSON strings (`topResults`, `customPoints`, `analysisData`)
- No concurrent writes — single-writer, safe for this single-user tool
- File-based — no connection pooling needed
