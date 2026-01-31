import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST() {
    console.log('[ProxyFetch] POST request received at /api/proxies/fetch');
    try {
        const sources = [
            { name: 'TheSpeedX', url: 'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt' },
            { name: 'ShiftyTR', url: 'https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/http.txt' },
            { name: 'Monosans', url: 'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt' },
            { name: 'ProxyListPlus', url: 'https://raw.githubusercontent.com/mmpx12/proxy-list/master/http.txt' },
            { name: 'ProxyListDownload', url: 'https://www.proxy-list.download/api/v1/get?type=http' },
            { name: 'ProxyScan', url: 'https://www.proxyscan.io/download?type=http' }
        ];

        // Safety Check: Check for active scans
        const activeScans = await prisma.scan.findFirst({
            where: { status: 'RUNNING' }
        });

        if (activeScans) {
            return NextResponse.json({
                success: false,
                logs: ['[CAUTION] Active scan detected.', '[ABORT] Proxy pool synchronization paused to prevent routing instability.'],
                count: 0
            });
        }

        let allProxies: string[] = [];
        const logs: string[] = [];

        for (const source of sources) {
            try {
                console.log(`[ProxyFetch] Fetching from ${source.name}: ${source.url}`);
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout per source

                const res = await fetch(source.url, {
                    next: { revalidate: 3600 },
                    signal: controller.signal
                }).finally(() => clearTimeout(timeoutId));

                if (!res.ok) throw new Error(`HTTP ${res.status}`);

                const text = await res.text();
                const lines = text.split('\n')
                    .map(l => l.trim())
                    .filter(l => l.includes(':') && l.length > 5);

                allProxies = [...allProxies, ...lines];
                console.log(`[ProxyFetch] ${source.name}: Got ${lines.length} proxies`);
                logs.push(`Fetched ${lines.length} proxies from ${source.name}`);
            } catch (err: any) {
                console.error(`[ProxyFetch] Failed ${source.name}:`, err.message);
                logs.push(`Failed to fetch from ${source.name}: ${err.message}`);
            }
        }

        console.log(`[ProxyFetch] Total unique potential proxies: ${new Set(allProxies).size}`);
        const uniqueEntries = Array.from(new Set(allProxies)).slice(0, 500);

        const proxyData = uniqueEntries.map(entry => {
            const [host, portStr] = entry.split(':');
            return {
                host,
                port: parseInt(portStr),
                type: 'DATACENTER' as const,
                enabled: true
            };
        }).filter(p => p.host && !isNaN(p.port));

        console.log(`[ProxyFetch] Saving ${proxyData.length} unique proxies...`);

        // SQLite doesn't support skipDuplicates in createMany. 
        // We filter out existing proxies manually to avoid unique constraint violations.
        const existingProxies = await (prisma as any).proxy.findMany({
            select: { host: true, port: true }
        });

        const existingKeys = new Set(existingProxies.map((p: any) => `${p.host}:${p.port}`));
        const newProxies = proxyData.filter(p => !existingKeys.has(`${p.host}:${p.port}`));

        console.log(`[ProxyFetch] Detected ${newProxies.length} new unique proxies (Filtered ${proxyData.length - newProxies.length} duplicates)`);

        let count = 0;
        if (newProxies.length > 0) {
            const result = await (prisma as any).proxy.createMany({
                data: newProxies
            });
            count = result.count;
        }

        console.log(`[ProxyFetch] Sync complete. Added ${count} new proxies.`);

        return NextResponse.json({
            success: true,
            sources: sources.map(s => s.name),
            logs: [...logs, `[SYNC] Added ${count} new unique routing coordinates.`],
            count: count
        });

    } catch (error: any) {
        console.error('[ProxyFetch] Global error:', error);
        return NextResponse.json({
            success: false,
            error: 'Failed to fetch proxies',
            details: error.message
        }, { status: 500 });
    }
}
