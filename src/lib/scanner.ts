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

    // Fetch enabled proxies
    const enabledProxies = await prisma.proxy.findMany({ where: { enabled: true } });

    const launchOptions: any = { headless: true };
    if (enabledProxies.length > 0) {
        const p = enabledProxies[0];
        launchOptions.proxy = {
            server: `${p.host}:${p.port}`,
            username: p.username || undefined,
            password: p.password || undefined,
        };
    }

    const browser = await chromium.launch(launchOptions);
    const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    // Grant geolocation permissions globally for the context
    await context.grantPermissions(['geolocation']);

    const page = await context.newPage();

    try {
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

            // Set geolocation for THIS specific point
            await context.setGeolocation({ latitude: point.lat, longitude: point.lng });

            const results = await scrapeGMB(page, scan.keyword, point.lat, point.lng);

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

            // Delay between points to avoid detection (slightly reduced since we are reusing context)
            await new Promise(resolve => setTimeout(resolve, 1500 + Math.random() * 2000));
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
                const currentAvg = currentResults.reduce((acc, r) => acc + (r.rank || 21), 0) / currentResults.length;
                const previousAvg = previousScan.results.reduce((acc, r) => acc + (r.rank || 21), 0) / previousScan.results.length;

                const diff = previousAvg - currentAvg; // Positive means improvement (rank decreased)
                if (Math.abs(diff) >= 0.5) {
                    await prisma.alert.create({
                        data: {
                            type: diff > 0 ? 'RANK_UP' : 'RANK_DOWN',
                            message: `${scan.businessName} rank ${diff > 0 ? 'improved' : 'dropped'} by ${Math.abs(diff).toFixed(1)} points for "${scan.keyword}"`,
                            scanId: scan.id
                        }
                    });
                }
            }
        }

        await prisma.scan.update({
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

        await prisma.alert.create({
            data: {
                type: 'SCAN_ERROR',
                message: `Scan failed for "${scan.keyword}": ${error instanceof Error ? error.message : String(error)}`,
                scanId: scanId
            }
        });
    } finally {
        await browser.close();
    }
}
