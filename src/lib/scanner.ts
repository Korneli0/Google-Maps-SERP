import { prisma } from './prisma';
import { generateGrid } from './grid';
import { scrapeGMB } from './scraper';
import { chromium } from 'playwright';

export async function runScan(scanId: string) {
    const scan = await prisma.scan.findUnique({
        where: { id: scanId },
    });

    if (!scan) throw new Error('Scan not found');

    await prisma.scan.update({
        where: { id: scanId },
        data: { status: 'RUNNING' },
    });

    const points = scan.customPoints
        ? JSON.parse(scan.customPoints)
        : generateGrid(scan.centerLat, scan.centerLng, scan.radius, scan.gridSize, scan.shape as any);

    // Fetch global settings
    const [enabledProxies, proxySetting] = await Promise.all([
        (prisma as any).proxy.findMany({ where: { enabled: true } }),
        (prisma as any).globalSetting.findUnique({ where: { key: 'useSystemProxy' } })
    ]);

    const useSystemProxy = proxySetting ? proxySetting.value === 'true' : true;

    let browser: any = null;
    let context: any = null;
    let page: any = null;
    let currentProxyId: string | null = null;

    async function initBrowser() {
        if (browser) await browser.close();

        const launchOptions: any = { headless: true };

        if (!useSystemProxy && enabledProxies.length > 0) {
            // Filter out the current failed proxy if possible
            const availableProxies = currentProxyId
                ? enabledProxies.filter(p => p.id !== currentProxyId)
                : enabledProxies;

            const p = availableProxies[Math.floor(Math.random() * availableProxies.length)] || enabledProxies[0];
            currentProxyId = p.id;

            launchOptions.proxy = {
                server: `http://${p.host}:${p.port}`,
                username: p.username || undefined,
                password: p.password || undefined,
            };
            console.log(`[Scanner] Initializing with proxy: ${p.host}:${p.port}`);
        } else {
            console.log(`[Scanner] Initializing Direct System Connection`);
        }

        browser = await chromium.launch(launchOptions);
        context = await browser.newContext({
            viewport: { width: 1280, height: 800 },
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        });
        await context.grantPermissions(['geolocation']);
        page = await context.newPage();
    }

    try {
        await initBrowser();

        for (const point of points) {
            // Check if scan has been stopped
            const currentScan = await prisma.scan.findUnique({
                where: { id: scanId },
                select: { status: true }
            });

            if (!currentScan || currentScan.status === 'STOPPED') {
                console.log(`Scan ${scanId} was stopped.`);
                break;
            }

            console.log(`Scraping point: ${point.lat}, ${point.lng}`);
            let results: any[] = [];
            let success = false;
            let attempts = 0;
            const maxAttempts = 3;

            while (!success && attempts < maxAttempts) {
                attempts++;
                try {
                    await context.setGeolocation({ latitude: point.lat, longitude: point.lng });
                    results = await scrapeGMB(page, scan.keyword, point.lat, point.lng);
                    success = true;
                } catch (scrapeError: any) {
                    console.error(`[Scanner] Attempt ${attempts} failed for point ${point.lat},${point.lng}: ${scrapeError.message}`);
                    if (attempts < maxAttempts) {
                        console.log(`[Scanner] Retrying with new proxy rotation...`);
                        await initBrowser();
                    }
                }
            }

            if (!success) {
                console.error(`[Scanner] Failed to scrape point ${point.lat},${point.lng} after ${maxAttempts} attempts.`);
                // We create a result with empty data to allow the scan to continue but show the failure
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
                const match = results.find(r => r.name.toLowerCase().includes(scan.businessName!.toLowerCase()));
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
            const previousScan = await (prisma as any).scan.findFirst({
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
                const currentAvg = currentResults.filter(r => r.rank !== null).reduce((acc, r) => acc + (r.rank || 21), 0) / (currentResults.filter(r => r.rank !== null).length || 1);
                const previousAvg = previousScan.results.filter(r => r.rank !== null).reduce((acc, r) => acc + (r.rank || 21), 0) / (previousScan.results.filter(r => r.rank !== null).length || 1);

                const diff = previousAvg - currentAvg;
                if (Math.abs(diff) >= 0.5) {
                    await (prisma as any).alert.create({
                        data: {
                            type: diff > 0 ? 'RANK_UP' : 'RANK_DOWN',
                            message: `${scan.businessName} rank ${diff > 0 ? 'improved' : 'dropped'} by ${Math.abs(diff).toFixed(1)} points for "${scan.keyword}"`,
                            scanId: scan.id
                        }
                    });
                }
            }
        }

        await (prisma as any).scan.update({
            where: { id: scanId },
            data: {
                status: 'COMPLETED',
                nextRun
            },
        });

    } catch (error) {
        console.error(`[Scanner] Critical failure in scan ${scanId}:`, error);
        await prisma.scan.update({
            where: { id: scanId },
            data: { status: 'FAILED' },
        });

        await (prisma as any).alert.create({
            data: {
                type: 'SCAN_ERROR',
                message: `Scan failed for "${scan.keyword}": ${error instanceof Error ? error.message : String(error)}`,
                scanId: scanId
            }
        });
    } finally {
        if (browser) await browser.close();
    }
}
