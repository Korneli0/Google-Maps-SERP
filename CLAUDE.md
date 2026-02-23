# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

GeoRanker (package: `gmbserp`) — a local SEO tool that tracks Google Maps rankings by scraping SERPs across a geo-coordinate grid using Playwright. Fully self-hosted, no external API keys needed. Stack: Next.js 16 (App Router), React 19, TypeScript 5, Prisma 5 with SQLite, Playwright, Tailwind CSS 4.

## Commands

```bash
npm run dev                                 # Dev server at localhost:3000
npm run build                               # Production build
npm run lint                                # ESLint (only code check — no test suite)
npx prisma generate                         # Regenerate client after schema changes
npx prisma migrate dev --name <name>        # Create + apply migration
npx prisma studio                           # DB browser GUI
```

## Architecture

### Scan execution flow
`POST /api/scans` → creates DB record → fires `runScan(scanId)` as a detached background promise (no queue/worker). The scanner (`src/lib/scanner.ts`) generates grid points, launches headless Chromium, creates a fresh isolated BrowserContext per grid point (spoofed geolocation, randomized UA/viewport), calls `scrapeGMB()`, matches results to target business, and saves to DB. Scanner polls `status` at each iteration to support stop/rerun.

### Scraping (`src/lib/scraper.ts`)
Navigates to Google Maps search URL with geo-coordinates embedded. Primary extraction parses `window.APP_INITIALIZATION_STATE` (structured API data). Falls back to DOM scraping via `div[role="article"]` selectors. Handles Google Consent dialogs.

### Grid generation (`src/lib/grid.ts`)
Four modes: SQUARE (NxN bounding box), CIRCLE (hexagonal rings), ZIP (4-sector clusters), SMART (adaptive concentric rings).

### Business matching
Place ID first (exact match), then fuzzy name normalization (strips suffixes like LLC/Inc, 80% token overlap threshold).

### Review intelligence
Playwright scraper (`src/lib/reviewScraper.ts`) handles scrolling/pagination for 1700+ reviews. Analysis pipeline (`reviewAnalyzer.ts` + compute files) produces 150+ metrics across 10 categories (sentiment, legitimacy, temporal trends, etc.). Uses SSE streaming (`text/event-stream`) for real-time progress.

### Competitor analysis (`src/lib/analysis.ts` + `insightEngine.ts`)
Aggregates `topResults` JSON from all grid points, deduplicates, computes per-competitor metrics. Insight engine scores threats, calculates market saturation, identifies opportunities.

## Key constraints

- **Playwright is server-side only** — never import in client components; all usage is in `src/lib/` called from API routes.
- **Leaflet requires `dynamic(() => import(...), { ssr: false })`** — the Map component cannot be server-rendered.
- **No external APIs** — geocoding uses Nominatim (OpenStreetMap). Google Maps data is scraped directly.
- **Prisma singleton** — import from `@/lib/prisma`. Uses `globalForPrisma` to avoid HMR re-instantiation. Some streaming routes (reviews) use a separate `new PrismaClient()`.
- **Path alias** — `@/` maps to `src/`.
- **TypeScript strict mode is OFF** (`"strict": false`).
- **SSE streaming** — `/api/reviews` POST uses `TransformStream` for real-time progress.
- **PATCH whitelisting** — `/api/scans/[id]` PATCH only allows specific fields.

## API routes

| Route | Purpose |
|---|---|
| `/api/scans` | CRUD + fires background scan |
| `/api/scans/[id]` | Get/delete/patch scan |
| `/api/scans/[id]/rerun` | Re-fire scan |
| `/api/scans/[id]/stop` | Stop running scan |
| `/api/scans/history` | Historical rank trends |
| `/api/scans/lookup` | Playwright business lookup |
| `/api/reviews` | List + start review scrape (SSE) |
| `/api/reviews/[id]` | Get/delete review analysis |
| `/api/reviews/preview` | Quick business preview |
| `/api/dashboard` | Aggregate stats |
| `/api/proxies` | Proxy CRUD + validation |
| `/api/settings` | GlobalSetting key-value pairs |
| `/api/logs` | System log entries |
| `/api/geocode` | Nominatim geocoding |

## UI patterns

- All pages are client components (`'use client'`) fetching data via `fetch('/api/...')` in `useEffect`.
- Layout chain: `RootLayout` (server) → `ClientLayout` (client, sidebar state via localStorage + `sidebar-toggle` custom event) → page.
- Scan report page polls every 3s while status is RUNNING.
- UI primitives in `src/components/ui/index.tsx`: Card, Button, Badge, Input, Select, Skeleton (built on Radix UI + CVA).

## Database

SQLite at `prisma/dev.db`. Key models: `Scan`, `Result`, `Proxy`, `Alert`, `GlobalSetting`, `SystemLog`, `ReviewAnalysis`, `Review`. See `prisma/schema.prisma` for full schema.
