import { prisma } from './prisma';
import { generateGrid } from './grid';
import { scrapeGMB } from './scraper';
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { logger } from './logger';
import type { Scan } from '@prisma/client';

/**
 * Derives regional settings based on coordinates.
 * Ensures English language preference while matching local region markers.
 */
function getRegionalSettings(lat: number, lng: number) {
    // Default to US English
    let locale = 'en-US';
    let timezoneId = 'UTC';

    // Logic to detect major regions by coordinate bounds
    if (lat > 24 && lat < 50 && lng > -125 && lng < -66) {
        // USA
        locale = 'en-US';
        if (lng > -85) timezoneId = 'America/New_York';
        else if (lng > -95) timezoneId = 'America/Chicago';
        else if (lng > -107) timezoneId = 'America/Denver';
        else timezoneId = 'America/Los_Angeles';
    } else if (lat > 49 && lat < 61 && lng > -11 && lng < 2) {
        // United Kingdom
        locale = 'en-GB';
        timezoneId = 'Europe/London';
    } else if (lat > 35 && lat < 72 && lng > -10 && lng < 40) {
        // Europe (using en- variants to keep language English)
        locale = 'en-FR';
        timezoneId = 'Europe/Paris';
        if (lng > 20) timezoneId = 'Europe/Berlin';
    } else if (lat > -48 && lat < -10 && lng > 110 && lng < 155) {
        // Australia
        locale = 'en-AU';
        timezoneId = 'Australia/Sydney';
    } else if (lat > 8 && lat < 37 && lng > 68 && lng < 98) {
        // India
        locale = 'en-IN';
        timezoneId = 'Asia/Kolkata';
    } else if (lat > 12 && lat < 35 && lng > 34 && lng < 60) {
        // Middle East
        locale = 'en-AE';
        timezoneId = 'Asia/Dubai';
    } else if (lat > 42 && lat < 83 && lng > -141 && lng < -52) {
        // Canada
        locale = 'en-CA';
        timezoneId = 'America/Toronto';
        if (lng < -110) timezoneId = 'America/Vancouver';
    }

    return { locale, timezoneId };
}

/**
 * Normalize a business name for accurate matching.
 * Strips common suffixes, punctuation, and extra whitespace.
 */
function normalizeBusinessName(name: string): string {
    return name
        .toLowerCase()
        .replace(/[''`]/g, "'")  // Normalize quotes
        .replace(/[^a-z0-9'\s]/g, ' ')  // Strip punctuation except apostrophes
        .replace(/\b(llc|inc|corp|ltd|co|the|and|of)\b/g, '')  // Remove common suffixes/articles
        .replace(/\s+/g, ' ')  // Collapse whitespace
        .trim();
}

/**
 * Check if two business names match, using normalized comparison.
 * Returns true if one name contains the other (after normalization).
 */
function businessNamesMatch(scanName: string, resultName: string): boolean {
    const normScan = normalizeBusinessName(scanName);
    const normResult = normalizeBusinessName(resultName);

    if (!normScan || !normResult) return false;

    // Exact match after normalization
    if (normScan === normResult) return true;

    // Check if one fully contains the other
    if (normResult.includes(normScan) || normScan.includes(normResult)) return true;

    // Token overlap check: if 80%+ of words in the scan name appear in the result
    const scanTokens = normScan.split(' ').filter(t => t.length > 1);
    const resultTokens = new Set(normResult.split(' ').filter(t => t.length > 1));
    if (scanTokens.length > 0) {
        const matchCount = scanTokens.filter(t => resultTokens.has(t)).length;
        if (matchCount / scanTokens.length >= 0.8) return true;
    }

    return false;
}

export async function runScan(scanId: string) {
    let browser: Browser | null = null;
    let currentProxyId: string | null = null;
    let scan: Scan | null = null;

    try {
        await logger.info(`[Launcher] Initializing scanner process...`, 'SCANNER', { scanId });

        scan = await prisma.scan.findUnique({
            where: { id: scanId },
        });

        if (!scan) {
            await logger.error(`[Launcher] Aborting: Scan ${scanId} not found in database.`, 'SCANNER');
            return;
        }

        await prisma.scan.update({
            where: { id: scanId },
            data: { status: 'RUNNING' },
        });

        await logger.info(`[Launcher] Status set to RUNNING for keyword: "${scan.keyword}"`, 'SCANNER');

        const points = scan.customPoints
            ? JSON.parse(scan.customPoints)
            : generateGrid(scan.centerLat, scan.centerLng, scan.radius, scan.gridSize, scan.shape as any);

        await logger.debug(`[Launcher] Generated ${points.length} coordinates for scan.`, 'SCANNER');

        // Initial fetch of proxy settings
        const proxySetting = await prisma.globalSetting.findUnique({ where: { key: 'useSystemProxy' } });
        const useSystemProxy = proxySetting ? proxySetting.value === 'true' : true;

        async function launchBrowser(failedProxyId?: string): Promise<Browser> {
            await logger.debug('Launching browser...', 'SCANNER', { failedProxyId });

            // If a proxy failed, mark it DEAD in the database immediately
            if (failedProxyId) {
                try {
                    await prisma.proxy.update({
                        where: { id: failedProxyId },
                        data: { status: 'DEAD', lastTestedAt: new Date() }
                    });
                } catch (err) {
                    console.error('[Scanner] Failed to update proxy status:', err);
                }
            }

            const launchOptions: any = { headless: true };

            if (!useSystemProxy) {
                // Fetch healthy proxies (ACTIVE or UNTESTED)
                const availableProxies = await prisma.proxy.findMany({
                    where: {
                        enabled: true,
                        status: { in: ['ACTIVE', 'UNTESTED'] }
                    }
                });

                if (availableProxies.length > 0) {
                    // Prioritize ACTIVE proxies if available, otherwise use UNTESTED
                    const activeOnes = availableProxies.filter((p: any) => p.status === 'ACTIVE');
                    const pool = activeOnes.length > 0 ? activeOnes : availableProxies;

                    const p = pool[Math.floor(Math.random() * pool.length)];
                    currentProxyId = p.id;

                    launchOptions.proxy = {
                        server: `http://${p.host}:${p.port}`,
                        username: p.username || undefined,
                        password: p.password || undefined,
                    };
                }
            }

            try {
                return await chromium.launch(launchOptions);
            } catch (launchErr: any) {
                await logger.warn(`Failed to launch browser with proxy ${launchOptions.proxy?.server || 'DIRECT'}: ${launchErr.message}. Retrying without proxy...`, 'SCANNER');

                // Mark the specific proxy as DEAD if it was the cause
                if (currentProxyId) {
                    await prisma.proxy.update({
                        where: { id: currentProxyId },
                        data: { status: 'DEAD', lastTestedAt: new Date() }
                    }).catch(() => { });
                }

                // Fallback to direct connection
                delete launchOptions.proxy;
                return await chromium.launch(launchOptions);
            }
        }

        /**
         * Create a completely fresh, isolated browser context for a single grid point.
         * This is CRITICAL for accuracy — prevents Google from personalizing results
         * based on cookies/history from previous grid points.
         */
        async function createFreshContext(b: Browser, lat: number, lng: number): Promise<{ context: BrowserContext; page: Page }> {
            const { locale, timezoneId } = getRegionalSettings(scan!.centerLat, scan!.centerLng);

            // Randomize viewport slightly to reduce fingerprinting
            const widthJitter = Math.floor(Math.random() * 40) - 20; // ±20px
            const heightJitter = Math.floor(Math.random() * 20) - 10; // ±10px

            const ctx = await b.newContext({
                viewport: { width: 1280 + widthJitter, height: 800 + heightJitter },
                userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                locale,
                timezoneId,
                // Start with zero state — no cookies, no storage
                storageState: { cookies: [], origins: [] },
                extraHTTPHeaders: {
                    'Accept-Language': 'en-US,en;q=0.9',
                    'DNT': '1',           // Do Not Track
                    'Sec-GPC': '1',       // Global Privacy Control
                },
                // Disable service workers to prevent caching
                serviceWorkers: 'block',
            });

            await ctx.grantPermissions(['geolocation']);
            await ctx.setGeolocation({ latitude: lat, longitude: lng });

            // Clear all storage as extra safety
            await ctx.clearCookies();

            const pg = await ctx.newPage();
            return { context: ctx, page: pg };
        }

        browser = await launchBrowser();

        for (const point of points) {
            // Check if scan has been stopped or reset
            const currentScan = await prisma.scan.findUnique({
                where: { id: scanId },
                select: { status: true }
            });

            // If status is PENDING, it means a NEW process (rerun) has reset this scan.
            // We must exit the OLD process loop immediately to avoid data corruption.
            if (!currentScan || currentScan.status === 'STOPPED' || currentScan.status === 'PENDING') {
                await logger.info(`Scan ${scanId} was stopped or reset. Current status: ${currentScan?.status}. Exiting process ${currentScan ? 'cleanly' : 'due to deletion'}.`, 'SCANNER');
                break;
            }

            let results: any[] = [];
            let success = false;
            let attempts = 0;
            const maxAttempts = 3;

            while (!success && attempts < maxAttempts) {
                attempts++;
                // Create a FRESH context for each attempt — this is the key accuracy fix.
                // Each grid point gets a clean browser with no cookies/cache/history.
                let pointContext: BrowserContext | null = null;
                let pointPage: Page | null = null;
                try {
                    const fresh = await createFreshContext(browser!, point.lat, point.lng);
                    pointContext = fresh.context;
                    pointPage = fresh.page;

                    results = await scrapeGMB(pointPage, scan.keyword, point.lat, point.lng);
                    success = true;

                    // Validate result count
                    if (results.length < 20) {
                        await logger.debug(`[Accuracy] Point ${point.lat},${point.lng}: only ${results.length} results found (expected ~20)`, 'SCANNER');
                    }
                } catch (scrapeError: any) {
                    await logger.warn(`Attempt ${attempts} failed for point ${point.lat},${point.lng}: ${scrapeError.message}`, 'SCANNER');
                    if (attempts < maxAttempts) {
                        const isProxyError = scrapeError.message.includes('ERR_PROXY_CONNECTION_FAILED') ||
                            scrapeError.message.includes('ERR_TUNNEL_CONNECTION_FAILED') ||
                            scrapeError.message.includes('TIMEOUT');

                        if (isProxyError) {
                            // Re-launch browser with a different proxy
                            if (browser) await browser.close().catch(() => { });
                            browser = await launchBrowser(currentProxyId || undefined);
                        }
                    }
                } finally {
                    // ALWAYS close the point context to free resources
                    if (pointContext) await pointContext.close().catch(() => { });
                }
            }

            if (!success) {
                await logger.warn(`Point capture failed: ${point.lat}, ${point.lng} after max attempts.`, 'SCANNER');
                await prisma.result.create({
                    data: {
                        scanId: scan.id,
                        lat: point.lat,
                        lng: point.lng,
                        topResults: JSON.stringify([]),
                        rank: null,
                    },
                });
                continue;
            }

            let rank = null;
            let targetName = null;

            if (scan.businessName) {
                // Use normalized matching instead of naive includes()
                const match = results.find(r => businessNamesMatch(scan.businessName!, r.name));
                if (match) {
                    rank = match.rank;
                    targetName = match.name;
                }
            }

            await prisma.result.create({
                data: {
                    scanId: scan.id,
                    lat: point.lat,
                    lng: point.lng,
                    topResults: JSON.stringify(results),
                    rank,
                    targetName
                },
            });
            await logger.debug(`Captured point ${point.lat},${point.lng}. Target Rank: ${rank || 'N/A'} (${results.length} results)`, 'SCANNER');

            // Random delay between points
            await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000));
        }

        // Calculate NEXT RUN if recurring
        let nextRun = null;
        if (scan.frequency === 'DAILY') {
            nextRun = new Date(Date.now() + 24 * 60 * 60 * 1000);
        } else if (scan.frequency === 'WEEKLY') {
            nextRun = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        }

        // Check for rank changes and create alerts
        if (scan.businessName) {
            const previousScan = await prisma.scan.findFirst({
                where: {
                    keyword: scan.keyword,
                    businessName: scan.businessName,
                    status: 'COMPLETED',
                    id: { not: scanId }
                },
                orderBy: { createdAt: 'desc' },
                include: { results: true }
            });

            if (previousScan) {
                const currentResults = await prisma.result.findMany({ where: { scanId } });
                const currentAvg = currentResults.filter((r: any) => r.rank !== null).reduce((acc: any, r: any) => acc + (r.rank || 21), 0) / (currentResults.filter((r: any) => r.rank !== null).length || 1);
                const previousAvg = previousScan.results.filter((r: any) => r.rank !== null).reduce((acc: any, r: any) => acc + (r.rank || 21), 0) / (previousScan.results.filter((r: any) => r.rank !== null).length || 1);

                const diff = previousAvg - currentAvg;
                if (Math.abs(diff) >= 0.5) {
                    // Use transaction to ensure both alert and status update succeed together
                    await prisma.$transaction([
                        prisma.alert.create({
                            data: {
                                type: diff > 0 ? 'RANK_UP' : 'RANK_DOWN',
                                message: `${scan.businessName} rank ${diff > 0 ? 'improved' : 'dropped'} by ${Math.abs(diff).toFixed(1)} points for "${scan.keyword}"`,
                                scanId: scan.id
                            }
                        }),
                        prisma.scan.update({
                            where: { id: scanId },
                            data: {
                                status: 'COMPLETED',
                                nextRun
                            }
                        })
                    ]);
                } else {
                    await prisma.scan.update({
                        where: { id: scanId },
                        data: {
                            status: 'COMPLETED',
                            nextRun
                        }
                    });
                }
            } else {
                await prisma.scan.update({
                    where: { id: scanId },
                    data: {
                        status: 'COMPLETED',
                        nextRun
                    }
                });
            }
        } else {
            await prisma.scan.update({
                where: { id: scanId },
                data: {
                    status: 'COMPLETED',
                    nextRun
                }
            });
        }

        await logger.info(`Scan sequence completed successfully for "${scan.keyword}"`, 'SCANNER', { scanId });
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        await logger.error(`Critical failure in scan: ${errorMsg}`, 'SCANNER', {
            scanId,
            stack: error instanceof Error ? error.stack : undefined
        });

        await prisma.scan.update({
            where: { id: scanId },
            data: { status: 'FAILED' },
        }).catch(() => { });

        if (scan) {
            await prisma.alert.create({
                data: {
                    type: 'SCAN_ERROR',
                    message: `Scan failed for "${scan.keyword}": ${errorMsg}`,
                    scanId: scanId
                }
            }).catch(() => { });
        }
    } finally {
        if (browser) await browser.close().catch(() => { });
    }
}
