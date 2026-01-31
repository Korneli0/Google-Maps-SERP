module.exports = [
"[externals]/next/dist/compiled/next-server/app-route-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-route-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/next-server/app-route-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-route-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/@opentelemetry/api [external] (next/dist/compiled/@opentelemetry/api, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/@opentelemetry/api", () => require("next/dist/compiled/@opentelemetry/api"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/next-server/app-page-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-page-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-unit-async-storage.external.js [external] (next/dist/server/app-render/work-unit-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/work-unit-async-storage.external.js", () => require("next/dist/server/app-render/work-unit-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-async-storage.external.js [external] (next/dist/server/app-render/work-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/work-async-storage.external.js", () => require("next/dist/server/app-render/work-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/shared/lib/no-fallback-error.external.js [external] (next/dist/shared/lib/no-fallback-error.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/shared/lib/no-fallback-error.external.js", () => require("next/dist/shared/lib/no-fallback-error.external.js"));

module.exports = mod;
}),
"[project]/src/lib/prisma.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "prisma",
    ()=>prisma
]);
var __TURBOPACK__imported__module__$5b$externals$5d2f40$prisma$2f$client__$5b$external$5d$__$2840$prisma$2f$client$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f40$prisma$2f$client$29$__ = __turbopack_context__.i("[externals]/@prisma/client [external] (@prisma/client, cjs, [project]/node_modules/@prisma/client)");
;
const globalForPrisma = /*TURBOPACK member replacement*/ __turbopack_context__.g;
const prisma = globalForPrisma.prisma || new __TURBOPACK__imported__module__$5b$externals$5d2f40$prisma$2f$client__$5b$external$5d$__$2840$prisma$2f$client$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f40$prisma$2f$client$29$__["PrismaClient"]();
if ("TURBOPACK compile-time truthy", 1) globalForPrisma.prisma = prisma;
}),
"[externals]/next/dist/server/app-render/after-task-async-storage.external.js [external] (next/dist/server/app-render/after-task-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/after-task-async-storage.external.js", () => require("next/dist/server/app-render/after-task-async-storage.external.js"));

module.exports = mod;
}),
"[project]/src/lib/grid.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "generateGrid",
    ()=>generateGrid
]);
function generateGrid(centerLat, centerLng, radiusKm, gridSize) {
    const points = [];
    // 1 degree of latitude is ~111.111 km
    const latDelta = radiusKm / 111.111;
    // 1 degree of longitude is ~111.111 * cos(lat) km
    const lngDelta = radiusKm / (111.111 * Math.cos(centerLat * (Math.PI / 180)));
    const startLat = centerLat - latDelta;
    const startLng = centerLng - lngDelta;
    const latStep = latDelta * 2 / (gridSize - 1);
    const lngStep = lngDelta * 2 / (gridSize - 1);
    for(let i = 0; i < gridSize; i++){
        for(let j = 0; j < gridSize; j++){
            points.push({
                lat: startLat + i * latStep,
                lng: startLng + j * lngStep
            });
        }
    }
    return points;
}
}),
"[project]/src/lib/scraper.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "scrapeGMB",
    ()=>scrapeGMB
]);
async function scrapeGMB(page, keyword, lat, lng) {
    try {
        console.log(`[Scraper] Starting scrape for: ${keyword} at ${lat}, ${lng}`);
        // Navigate with a more realistic timeout and wait strategy
        // Google Maps takes a long time to reach networkidle, so we use domcontentloaded
        await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(keyword)}/@${lat},${lng},14z/`, {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });
        // Wait for results to load - use multiple common selectors
        try {
            await page.waitForFunction(()=>{
                return !!(document.querySelector('[role="article"]') || document.querySelector('.qBF1Pd') || document.querySelector('[role="feed"]'));
            }, {
                timeout: 20000
            });
        } catch (e) {
            console.log('[Scraper] Warning: Standard result selectors not found, trying fallback extraction anyway.');
        }
        // Mimic human scrolling behavior
        for(let i = 0; i < 3; i++){
            await page.evaluate(()=>{
                const scrollable = document.querySelector('[role="feed"]') || document.body;
                scrollable.scrollBy(0, 800);
            });
            await page.waitForTimeout(1000 + Math.random() * 1000);
        }
        // Extract results with robust, multiple-path selectors
        // We use a self-invoking function string to avoid any transpilation artifacts like __name
        const results = await page.evaluate(()=>{
            const extracted = [];
            // Priority 1: Articles with specific roles
            let items = Array.from(document.querySelectorAll('div[role="article"]'));
            // Priority 2: Links that look like place profiles
            if (items.length === 0) {
                const links = Array.from(document.querySelectorAll('a[href*="/maps/place/"]'));
                items = links.map((l)=>l.closest('div') || l).filter(Boolean);
            }
            const seenNames = new Set();
            items.forEach((item)=>{
                if (extracted.length >= 20) return;
                let name = '';
                const ariaLabel = item.getAttribute('aria-label');
                if (ariaLabel && !ariaLabel.includes('stars') && ariaLabel.length > 2) {
                    name = ariaLabel;
                }
                if (!name) {
                    const nameEl = item.querySelector('.fontHeadlineSmall, .qBF1Pd, [role="heading"]');
                    name = nameEl?.textContent?.trim() || '';
                }
                if (!name || name.length < 2) return;
                name = name.split(' · ')[0].replace(/\. \d+$/, '').trim();
                if (seenNames.has(name.toLowerCase())) return;
                seenNames.add(name.toLowerCase());
                const ratingEl = item.querySelector('[role="img"][aria-label*="stars"]');
                const ratingLabel = ratingEl?.getAttribute('aria-label') || '';
                const ratingMatch = ratingLabel.match(/([0-9.]+)\s+stars/);
                const rating = ratingMatch ? parseFloat(ratingMatch[1]) : undefined;
                const text = item.innerText || '';
                const lines = text.split('\n');
                const address = lines.find((l)=>l.match(/\d+/) && l !== name && l.length > 5) || '';
                extracted.push({
                    name,
                    rating,
                    reviews: 0,
                    address: address.trim(),
                    rank: extracted.length + 1
                });
            });
            return extracted;
        });
        console.log(`[Scraper] Successfully extracted ${results.length} results.`);
        return results;
    } catch (error) {
        console.error(`[Scraper] Error scraping ${lat},${lng}:`, error);
        return [];
    }
}
}),
"[project]/src/lib/scanner.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

return __turbopack_context__.a(async (__turbopack_handle_async_dependencies__, __turbopack_async_result__) => { try {

__turbopack_context__.s([
    "runScan",
    ()=>runScan
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$prisma$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/prisma.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$grid$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/grid.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$scraper$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/scraper.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$playwright__$5b$external$5d$__$28$playwright$2c$__esm_import$2c$__$5b$project$5d2f$node_modules$2f$playwright$29$__ = __turbopack_context__.i("[externals]/playwright [external] (playwright, esm_import, [project]/node_modules/playwright)");
var __turbopack_async_dependencies__ = __turbopack_handle_async_dependencies__([
    __TURBOPACK__imported__module__$5b$externals$5d2f$playwright__$5b$external$5d$__$28$playwright$2c$__esm_import$2c$__$5b$project$5d2f$node_modules$2f$playwright$29$__
]);
[__TURBOPACK__imported__module__$5b$externals$5d2f$playwright__$5b$external$5d$__$28$playwright$2c$__esm_import$2c$__$5b$project$5d2f$node_modules$2f$playwright$29$__] = __turbopack_async_dependencies__.then ? (await __turbopack_async_dependencies__)() : __turbopack_async_dependencies__;
;
;
;
;
async function runScan(scanId) {
    const scan = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$prisma$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["prisma"].scan.findUnique({
        where: {
            id: scanId
        }
    });
    if (!scan) throw new Error('Scan not found');
    await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$prisma$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["prisma"].scan.update({
        where: {
            id: scanId
        },
        data: {
            status: 'RUNNING'
        }
    });
    const points = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$grid$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["generateGrid"])(scan.centerLat, scan.centerLng, scan.radius, scan.gridSize);
    // Launch browser ONCE for the entire scan
    const browser = await __TURBOPACK__imported__module__$5b$externals$5d2f$playwright__$5b$external$5d$__$28$playwright$2c$__esm_import$2c$__$5b$project$5d2f$node_modules$2f$playwright$29$__["chromium"].launch({
        headless: true
    });
    const context = await browser.newContext({
        viewport: {
            width: 1280,
            height: 800
        },
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    // Grant geolocation permissions globally for the context
    await context.grantPermissions([
        'geolocation'
    ]);
    const page = await context.newPage();
    try {
        for (const point of points){
            // Check if scan has been stopped
            const currentScan = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$prisma$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["prisma"].scan.findUnique({
                where: {
                    id: scanId
                },
                select: {
                    status: true
                }
            });
            if (!currentScan || currentScan.status === 'STOPPED') {
                console.log(`Scan ${scanId} was stopped.`);
                break;
            }
            console.log(`Scraping point: ${point.lat}, ${point.lng}`);
            // Set geolocation for THIS specific point
            await context.setGeolocation({
                latitude: point.lat,
                longitude: point.lng
            });
            const results = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$scraper$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["scrapeGMB"])(page, scan.keyword, point.lat, point.lng);
            let rank = null;
            let targetName = null;
            if (scan.businessName) {
                const match = results.find((r)=>r.name.toLowerCase().includes(scan.businessName.toLowerCase()));
                if (match) {
                    rank = match.rank;
                    targetName = match.name;
                }
            }
            await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$prisma$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["prisma"].result.create({
                data: {
                    scanId: scan.id,
                    lat: point.lat,
                    lng: point.lng,
                    topResults: JSON.stringify(results),
                    rank,
                    targetName
                }
            });
            // Delay between points to avoid detection (slightly reduced since we are reusing context)
            await new Promise((resolve)=>setTimeout(resolve, 1500 + Math.random() * 2000));
        }
        await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$prisma$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["prisma"].scan.update({
            where: {
                id: scanId
            },
            data: {
                status: 'COMPLETED'
            }
        });
    } catch (error) {
        console.error(`[Scanner] Critical failure in scan ${scanId}:`, error);
        await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$prisma$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["prisma"].scan.update({
            where: {
                id: scanId
            },
            data: {
                status: 'FAILED'
            }
        });
    } finally{
        await browser.close();
    }
}
__turbopack_async_result__();
} catch(e) { __turbopack_async_result__(e); } }, false);}),
"[project]/src/app/api/scans/route.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

return __turbopack_context__.a(async (__turbopack_handle_async_dependencies__, __turbopack_async_result__) => { try {

__turbopack_context__.s([
    "GET",
    ()=>GET,
    "POST",
    ()=>POST
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$prisma$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/prisma.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/server.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$scanner$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/scanner.ts [app-route] (ecmascript)");
var __turbopack_async_dependencies__ = __turbopack_handle_async_dependencies__([
    __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$scanner$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__
]);
[__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$scanner$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__] = __turbopack_async_dependencies__.then ? (await __turbopack_async_dependencies__)() : __turbopack_async_dependencies__;
;
;
;
async function GET() {
    try {
        const scans = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$prisma$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["prisma"].scan.findMany({
            orderBy: {
                createdAt: 'desc'
            }
        });
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            scans
        });
    } catch (error) {
        console.error('Scans GET error:', error);
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            scans: []
        });
    }
}
async function POST(req) {
    try {
        const { keyword, address, radius, gridSize, frequency, businessName } = await req.json();
        // MOCKING Geocoding - In production, use Google Maps Geocoding API
        const centerLat = 41.8781;
        const centerLng = -87.6298;
        const scan = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$prisma$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["prisma"].scan.create({
            data: {
                keyword,
                centerLat,
                centerLng,
                radius: parseFloat(radius) || 5,
                gridSize: parseInt(gridSize) || 3,
                frequency: frequency || 'ONCE',
                businessName: businessName || undefined,
                status: 'PENDING'
            }
        });
        // Start scan in background
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$scanner$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["runScan"])(scan.id).catch(console.error);
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json(scan);
    } catch (error) {
        console.error('Scan creation CRITICAL error:', error);
        if (error instanceof Error) {
            console.error('Error message:', error.message);
            console.error('Error stack:', error.stack);
        }
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            error: 'Failed to create scan',
            details: String(error)
        }, {
            status: 500
        });
    }
}
__turbopack_async_result__();
} catch(e) { __turbopack_async_result__(e); } }, false);}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__5ae1b762._.js.map