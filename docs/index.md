# GeoRanker Technical Documentation

> Local SEO ranking tracker that scrapes Google Maps SERPs across a geo-coordinate grid using Playwright. Self-hosted, no external API keys.

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript 5 (`strict: false`) |
| UI | React 19, Tailwind CSS 4, Radix UI, Framer Motion |
| Maps | Leaflet 1.9 + react-leaflet (client-only, `ssr: false`) |
| Charts | Recharts 3.7 |
| Scraping | Playwright 1.58 (headless Chromium) |
| Database | SQLite via Prisma 5 |
| NLP | Custom hybrid engine (VADER/AFINN-inspired) + wink-nlp |
| Export | jsPDF + jspdf-autotable, ExcelJS |
| Icons | Lucide React |

## Architecture Overview

```
┌────────────────────────────────────────────────────────────────────┐
│                        Next.js App Router                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐ │
│  │    Pages      │  │  Components  │  │      API Routes          │ │
│  │  (client)     │  │  (client)    │  │   (server-side only)     │ │
│  └──────┬───────┘  └──────────────┘  └──────────┬───────────────┘ │
│         │ fetch('/api/...')                      │                  │
│         └───────────────────────────────────────►│                  │
└─────────────────────────────────────────────────┼──────────────────┘
                                                  │
          ┌───────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Core Library (src/lib/)                   │
│                                                                  │
│  ┌─────────────┐    ┌─────────────┐    ┌──────────────────────┐ │
│  │  scanner.ts  │───►│  scraper.ts │    │  reviewScraper.ts    │ │
│  │ orchestrator │    │  DOM + API  │    │  Google Reviews      │ │
│  └──────┬──────┘    └─────────────┘    └──────────┬───────────┘ │
│         │                                         │              │
│  ┌──────┴──────┐    ┌─────────────┐    ┌──────────┴───────────┐ │
│  │   grid.ts   │    │ analysis.ts │    │  reviewAnalyzer.ts   │ │
│  │ coord gen   │    │ competitors │    │  150+ metrics        │ │
│  └─────────────┘    └──────┬──────┘    └──────────┬───────────┘ │
│                            │                      │              │
│                     ┌──────┴──────┐    ┌──────────┴───────────┐ │
│                     │insightEngine│    │  sentimentEngine.ts  │ │
│                     │  threats    │    │  VADER/AFINN hybrid  │ │
│                     └─────────────┘    └──────────────────────┘ │
│                                                                  │
│  ┌─────────────┐    ┌─────────────┐    ┌──────────────────────┐ │
│  │  export.ts  │    │  logger.ts  │    │   proxy-tester.ts    │ │
│  │ XLSX + PDF  │    │ console+DB  │    │   HTTP validation    │ │
│  └─────────────┘    └─────────────┘    └──────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                   SQLite (prisma/dev.db)                          │
│  Scan ──┬── Result                                               │
│         └── Alert          ReviewAnalysis ── Review               │
│  Proxy   GlobalSetting   SystemLog                               │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow: Scan Lifecycle

```
User submits scan form
        │
        ▼
POST /api/scans ─── Create Scan record (PENDING)
        │
        ▼
runScan(scanId) ─── Background promise (fire-and-forget)
        │
        ├── Status → RUNNING
        ├── generateGrid() → GridPoint[]
        ├── launchBrowser() (with optional proxy)
        │
        ▼
For each GridPoint:
        ├── createFreshContext() ── zero-state browser, spoofed geo
        ├── scrapeGMB(page, keyword, lat, lng)
        │     ├── Navigate to Google Maps search URL
        │     ├── Scroll feed to load all ~20 results
        │     ├── extractFromAPIData() ── parse APP_INITIALIZATION_STATE
        │     └── (fallback) DOM scraping via div[role="article"]
        ├── Match target business (PlaceID → fuzzy name)
        ├── Save Result to DB
        └── Random 2-5s delay
        │
        ▼
Completion:
        ├── Compare avg rank with previous scan
        ├── Create RANK_UP/RANK_DOWN alert if delta ≥ 0.5
        ├── Set nextRun for recurring scans
        └── Status → COMPLETED
```

## Critical Constraints

1. **Playwright runs server-side only** — never import in client components
2. **Leaflet requires `dynamic(() => import(...), { ssr: false })`**
3. **No external APIs** — all data scraped directly via Playwright
4. **Background execution** — scans run as detached promises from API routes, no job queue
5. **Path alias** — `@/` maps to `src/`

## Documentation Index

| Document | Description |
|----------|-------------|
| [Scan Engine](./scanning.md) | Scan orchestration, browser contexts, business matching, retry logic |
| [Google Maps Scraper](./scraping.md) | Dual extraction strategy (API + DOM), field mapping, consent handling |
| [Grid Algorithms](./grid-algorithms.md) | SQUARE, CIRCLE, ZIP, SMART coordinate generation with math |
| [Review Intelligence](./review-intelligence.md) | Review scraping, 150+ metric analysis pipeline, SSE streaming |
| [Sentiment Engine](./sentiment-engine.md) | 5-layer hybrid VADER/AFINN analysis, phrase detection, aspects |
| [Competitor Analysis](./competitor-analysis.md) | Intelligence aggregation, threat scoring, opportunity detection |
| [API Reference](./api-reference.md) | All endpoints with request/response formats |
| [Database](./database.md) | Prisma schema, models, relationships, JSON field schemas |
| [UI Architecture](./ui-architecture.md) | Pages, components, layout system, map integration |
| [Proxy System](./proxy-system.md) | Proxy pool management, validation, rotation |
| [Export](./export.md) | XLSX and PDF report generation |

## Module Dependency Graph

```
scanner.ts
  ├── grid.ts
  ├── scraper.ts
  ├── prisma.ts
  └── logger.ts

scraper.ts
  └── logger.ts

reviewScraper.ts
  └── logger.ts

reviewAnalyzer.ts
  ├── reviewAnalyzerCompute.ts
  │     └── sentimentEngine.ts
  ├── reviewAnalyzerCompute2.ts
  │     └── sentimentEngine.ts
  └── reviewAnalyzerTypes.ts

analysis.ts
  └── scraper.ts (types only)

insightEngine.ts
  └── (standalone)

export.ts
  └── (standalone, client-side)

proxy-tester.ts
  └── (standalone, uses node:http)
```
