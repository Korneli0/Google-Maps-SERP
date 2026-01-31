import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST() {
    try {
        const sources = [
            { name: 'TheSpeedX', url: 'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt' },
            { name: 'ShiftyTR', url: 'https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/http.txt' }
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
                const res = await fetch(source.url);
                const text = await res.text();
                const lines = text.split('\n').map(l => l.trim()).filter(l => l.includes(':'));
                allProxies = [...allProxies, ...lines];
                logs.push(`Fetched ${lines.length} proxies from ${source.name}`);
            } catch (err) {
                console.error(`Failed to fetch from ${source.name}:`, err);
                logs.push(`Failed to fetch from ${source.name}`);
            }
        }

        const uniqueProxies = Array.from(new Set(allProxies)).slice(0, 50);

        for (const entry of uniqueProxies) {
            const [host, port] = entry.split(':');
            if (!host || !port) continue;

            const exists = await prisma.proxy.findFirst({
                where: { host, port: parseInt(port) }
            });

            if (!exists) {
                await prisma.proxy.create({
                    data: {
                        host,
                        port: parseInt(port),
                        type: 'DATACENTER',
                        enabled: true
                    }
                });
            }
        }

        return NextResponse.json({
            success: true,
            sources: sources.map(s => s.name),
            logs,
            count: uniqueProxies.length
        });

    } catch (error) {
        console.error('Proxy fetcher error:', error);
        return NextResponse.json({ error: 'Failed to fetch proxies' }, { status: 500 });
    }
}
