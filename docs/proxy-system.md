# Proxy System

> `src/lib/proxy-tester.ts` — HTTP proxy validation.
> `src/app/api/proxies/` — CRUD, batch validation, and auto-fetch from public sources.

## Proxy Lifecycle

```
                  ┌──────────┐
                  │ UNTESTED │ ← newly added or fetched
                  └────┬─────┘
                       │ validate
                 ┌─────┴─────┐
                 ▼           ▼
            ┌────────┐  ┌────────┐
            │ ACTIVE │  │  DEAD  │
            └────┬───┘  └────────┘
                 │
                 │ fails during scan
                 ▼
            ┌────────┐
            │  DEAD  │
            └────────┘
```

## Proxy Model

| Field | Type | Description |
|-------|------|-------------|
| `host` | String | Hostname or IP |
| `port` | Int | Port number |
| `username` | String? | Auth username |
| `password` | String? | Auth password |
| `type` | String | `RESIDENTIAL` or `DATACENTER` |
| `enabled` | Boolean | In pool or disabled |
| `status` | String | `UNTESTED`, `ACTIVE`, `DEAD` |
| `lastTestedAt` | DateTime? | Last validation timestamp |

Unique constraint on `[host, port]`.

## Proxy Validation

### `checkProxy(host, port, username?, password?): ProxyTestResult`

Tests a single proxy by making an HTTP request through it.

| Setting | Value |
|---------|-------|
| Target URL | `http://www.google.com/generate_204` |
| Expected response | 204 No Content (accepts any 200-399) |
| Timeout | 5 seconds |
| User-Agent | Chrome 120 on Windows |
| Auth | Basic auth via `Proxy-Authorization` header (Base64 encoded) |

Returns:
```typescript
interface ProxyTestResult {
    success: boolean;
    latency?: number;   // milliseconds
    error?: string;
}
```

### `validateProxyBatch(proxies, concurrency = 10): ProxyTestResult[]`

Worker pool pattern for batch validation.

```
queue = [...proxies]

spawn min(concurrency, proxies.length) workers
each worker:
    while queue not empty:
        proxy = queue.shift()
        result = await checkProxy(proxy)
        results.push(result)

await all workers
return results
```

Default concurrency: 10 workers. The API endpoint overrides to 20.

## Scanner Proxy Rotation

In `src/lib/scanner.ts`, proxy usage is controlled by the `useSystemProxy` GlobalSetting:

| Setting | Behavior |
|---------|----------|
| `useSystemProxy = "true"` (default) | Direct connection, no proxy |
| `useSystemProxy = "false"` | Use proxy pool |

### Proxy Selection

When using pool:
1. Fetch all proxies where `enabled = true` AND `status IN ('ACTIVE', 'UNTESTED')`
2. Separate into ACTIVE and UNTESTED pools
3. If ACTIVE proxies exist → pick randomly from ACTIVE
4. Otherwise → pick randomly from UNTESTED
5. Set as Playwright `proxy.server: "http://{host}:{port}"`

### Failure Recovery

```
scrapeGMB() throws error
    │
    ├── Error contains "ERR_PROXY_CONNECTION_FAILED"
    │   or "ERR_TUNNEL_CONNECTION_FAILED"
    │   or "TIMEOUT"
    │
    ▼
    Close browser
    Call launchBrowser(currentProxyId)
    │
    ├── Mark failed proxy DEAD in DB
    ├── Select new proxy from pool
    └── If new proxy also fails → fallback to direct connection
```

### Browser Launch Failure

If `chromium.launch()` fails with proxy settings:
1. Mark the proxy as DEAD
2. Remove proxy from launch options
3. Retry launch without any proxy (direct connection)

## Auto-Fetch from Public Sources

`POST /api/proxies/fetch` fetches free proxies from 4 GitHub repositories:

| Source | Repository |
|--------|-----------|
| TheSpeedX | `TheSpeedX/SOCKS-List` (HTTP list) |
| ShiftyTR | `ShiftyTR/Proxy-List` |
| Monosans | `monosans/proxy-list` |
| ProxyListPlus | `a2u/free-proxy-list` |

### Process

1. **Safety check** — abort if any scan has status `RUNNING`
2. **Fetch** — GET each URL with 8-second timeout
3. **Parse** — split by newline, filter lines containing `:`, extract `host:port`
4. **Deduplicate** — by `host:port` across all sources
5. **Validate** — test top 100 proxies via `validateProxyBatch()`
6. **Map status** — success → `ACTIVE`, failure → `DEAD`, untested → `UNTESTED`
7. **Filter existing** — skip proxies already in DB (manual dedup for SQLite)
8. **Insert** — one-by-one (not batch, to handle schema mismatches gracefully)

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/proxies` | List all proxies |
| `POST` | `/api/proxies` | Add single proxy (409 on duplicate) |
| `PUT` | `/api/proxies` | Update proxy fields |
| `DELETE` | `/api/proxies?id=...` | Delete one or all (`id=all`) |
| `PATCH` | `/api/proxies` | Validate all (`action: "VALIDATE_ALL"`) |
| `POST` | `/api/proxies/fetch` | Auto-fetch from public sources |

See [API Reference](./api-reference.md) for full request/response details.
