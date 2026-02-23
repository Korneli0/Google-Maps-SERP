# UI Architecture

> Next.js 16 App Router pages and React components. All pages are client components using `fetch('/api/...')` for data.

## Layout Chain

```
RootLayout (server component)
  └── <body> with Inter font + Tailwind base classes
       └── ClientLayout (client component)
            ├── <Sidebar /> — collapsible nav
            ├── <main> — page content with PageTransition
            ├── <UpdateNotifier /> — update banner
            └── Footer
```

### RootLayout (`src/app/layout.tsx`)

Server component. Applies:
- Inter font via CSS variable `--font-inter`
- PWA metadata (manifest, theme-color, apple-web-app)
- Body classes: `font-sans antialiased text-gray-900 bg-gray-50`

### ClientLayout (`src/components/layout/ClientLayout.tsx`)

Client component managing sidebar collapse state.

**State:** `collapsed: boolean` — persisted in `localStorage`.

**Sync mechanism:** Two event listeners:
- `storage` event — syncs across browser tabs
- Custom `sidebar-toggle` event — syncs within the same tab (localStorage events don't fire for same-tab changes)

**Layout:** Flex row. Main content shifts margin: `ml-20` (collapsed) / `ml-64` (expanded) with CSS transition.

### Sidebar (`src/components/layout/Sidebar.tsx`)

Collapsible sidebar with 7 nav items.

| Item | Path | Icon |
|------|------|------|
| Dashboard | `/` | LayoutDashboard |
| Rank Tracker | `/scans` | Radar |
| Review Intel | `/reviews` | Star |
| Power Tools | `/tools` | Wrench |
| Schedules | `/schedules` | Calendar |
| Reports | `/reports` | FileText |
| Settings | `/settings` | Settings |

**Features:**
- Collapse toggle dispatches `sidebar-toggle` CustomEvent
- Active route detection: exact match for `/`, `startsWith` for others
- Collapsed mode: icon-only with hover tooltips
- User name from `localStorage` key `gmbserp_user_name`
- "New Report" CTA button above nav
- Footer: user avatar (initials), online indicator, Help link

---

## Pages

### Dashboard (`/`) — `src/app/page.tsx`

**Fetch:** `GET /api/dashboard` on mount (no polling).

**Structure:**
1. `<LookbackNotifier />` — prompts for missed scheduled scans
2. Header with "New Ranking Report" CTA
3. Stat cards (4-column): Total Scans, Active Scans, Pro Tip card (2-col span)
4. Recent Scans table with skeleton loading, empty state

### New Scan (`/scans/new`) — `src/app/scans/new/page.tsx`

3-step wizard with Framer Motion transitions.

**Step 1 — Keywords:**
- Scan mode toggle: Quick (keyword only) / Business (track specific business)
- Business lookup: name search (debounced 800ms → `POST /api/scans/lookup`) or URL import
- Keyword input, address geocoding (`GET /api/geocode`)
- Leaflet map in selection mode (draggable center, radius preview)

**Step 2 — Configuration:**
- Grid strategy toggle: Geometric / City
- Geometric: shape select (SQUARE/CIRCLE), radius slider, density select
- City: cascading Combobox (country → state → city via `/api/locations/autocomplete`), zip/neighborhood strategy via `/api/geocode/city`
- Draggable-pin map preview with "Edit Grid" dialog
- `customPoints` resets to null when geometric params change

**Step 3 — Schedule:**
- Radio cards: ONCE / DAILY / WEEKLY
- Submit → `POST /api/scans` → redirect to `/scans/:id`

**State:** 14+ state variables for form data, lookup results, grid strategy, location cascades.

### Scan Report (`/scans/[id]`) — `src/app/scans/[id]/page.tsx`

**Fetch:** `GET /api/scans/:id` on mount. Polls every 5s while status is `RUNNING` or `PENDING`.

**Computed metrics (on render):**
- `avgRank` — average of non-null ranks (null treated as 20)
- `visibilityScore` — CTR-weighted rank score (industry benchmarks)
- `competitorsList` — aggregated from topResults JSON blobs across all grid points

**4-tab layout:**

| Tab | Content |
|-----|---------|
| Spatial View | Leaflet map (results mode), heatmap toggle, click → pin inspector |
| Grid Status | Expandable rows table: lat/lng, rank badge, BusinessCard grid per point |
| Competitors | Competitor table: appearances, visibility %, top-3/top-10 counts |
| Intelligence | `<CompetitorIntelligenceDashboard>` — threat analysis |

**Above tabs:** Visibility score cards (when tracking a business), top-3 preview cards, `<TrendChart>`, `<ScanHeader>`.

**Actions:** Stop, Rerun, Delete, Export (XLSX/PDF), Share (Web Share API).

**Right sidebar:** `<PinInspectionSidebar>` — details for selected grid point.

### Review Analysis (`/reviews/[id]`) — `src/app/reviews/[id]/page.tsx`

**Fetch:** `GET /api/reviews/:id` on mount. Polls every 4s unconditionally.

**Status gate:** Shows loading splash until `COMPLETED`.

**Analysis sections (conditional on data presence):**

1. Header — business name, health score badge, export buttons
2. KPI grid — 11 stat cards
3. Strengths / Weaknesses / Risk Alerts — with `<SourceReviews>` attribution
4. Rating Distribution — horizontal bars + stats
5. Sentiment Analysis — counts, emotions, extreme quotes, aspect grid
6. Response Quality — 4 stats
7. Reviewer Legitimacy — trust score, suspicious patterns
8. Topics & Keywords — tagged keyword/phrase pills, theme accordions
9. Temporal Trends — monthly volume bar chart (last 12 months)
10. Competitive Benchmarks — industry comparison cards
11. Action Items — priority issues, quick wins, strategies, suggested responses
12. All Reviews — searchable, filterable review cards

**Export:**
- CSV — client-side Blob generation
- PDF — opens new tab with HTML document, calls `window.print()`

### Other Pages

| Page | Path | Description |
|------|------|-------------|
| Scans List | `/scans` | Table of all scans with status, actions |
| Reviews List | `/reviews` | URL input, preview modal, analysis history |
| Reports | `/reports` | Completed scans table with download actions |
| Schedules | `/schedules` | Recurring scan management (feature preview state) |
| Settings | `/settings` | 5 tabs: General, Proxies, Providers, Notifications, Logs |
| Power Tools | `/tools` | Review link generator, CID/PlaceID extractor |
| Help | `/help` | Profile score breakdown, FAQs, feature guides |

---

## Map Component

> `src/components/ui/Map.tsx` — **Must be imported with `dynamic(() => import(...), { ssr: false })`**

### Props

| Prop | Type | Description |
|------|------|-------------|
| `center` | `[number, number]` | Map center [lat, lng] |
| `zoom` | `number` | Zoom level |
| `points` | `GridPoint[]` | Grid points to render |
| `onCenterChange` | `(lat, lng) => void` | Center changed callback |
| `selectionMode` | `boolean` | Selection vs results mode |
| `radius` | `number` | Scan radius for preview circle |
| `gridSize` | `number` | Grid density |
| `onPointClick` | `(point) => void` | Grid point clicked |
| `onPointMove` | `(id, lat, lng) => void` | Dragged point moved |
| `onGridMove` | `(lat, lng) => void` | Center marker dragged |
| `showHeatmap` | `boolean` | Enable heatmap overlay |

### Modes

**Selection mode:** Blue dashed radius circle, draggable center marker, "Interactive Mode" hint. Map clicks fire `onCenterChange`.

**Results mode:** Color-coded `CircleMarker` per point. Optional heatmap (800m semi-transparent circles). Floating rank legend.

### Rank Color Scheme

| Rank | Color |
|------|-------|
| 1-3 | Green (#22c55e) |
| 4-10 | Amber (#f59e0b) |
| 11+ | Red (#ef4444) |
| Has data, no rank | Blue (#3b82f6) |
| No data | Gray (#9ca3af) |

### Internal Components

- `MapUpdater` — syncs `center`/`zoom` props to Leaflet `setView()`
- `SelectionHandler` — translates map click events to callbacks
- `RankMarker` — ranked circle marker with optional drag support
- `MapResizer` — `invalidateSize()` after modal animations

Tile layer: CARTO Voyager (not Google Maps tiles).

---

## UI Primitives

> `src/components/ui/index.tsx`

Built with `class-variance-authority` (CVA) + Radix UI.

### Button

Variants: `default`, `secondary`, `outline`, `ghost`, `destructive`, `link`
Sizes: `default`, `sm`, `lg`, `icon`
Props: `isLoading` (shows Loader2 spinner, disables button), `asChild` (via Radix Slot)

### Card

`bg-white border rounded-xl` wrapper. `noPadding` prop skips internal padding.

### Badge

Variants: `default`, `success`, `warning`, `destructive`, `blue`, `outline`

### Input

Optional `icon` prop renders left-positioned Lucide icon.

### Select

Optional `icon` prop. Custom chevron SVG replaces browser default.

### Progress

Color prop: `green`, `blue`, `yellow`, `red`. Size: `sm`, `default`. Percentage from `value/max`.

### Skeleton

`animate-pulse bg-gray-200 rounded-md` with passthrough className.

---

## Data Fetching Patterns

All pages follow the same pattern:

```typescript
'use client';

const [data, setData] = useState(null);
const [loading, setLoading] = useState(true);

useEffect(() => {
    fetch('/api/...')
        .then(res => res.json())
        .then(data => { setData(data); setLoading(false); })
        .catch(() => setLoading(false));
}, []);
```

**Polling:** Some pages poll while status is active:
- Scan report: every 5s while `RUNNING`/`PENDING`
- Review analysis: every 4s unconditionally

**SSE:** Review creation uses `EventSource`-style reading from `text/event-stream` response.
