import { prisma } from '@/lib/prisma';
import ScansClient from './ScansClient';

export default async function ScansPage() {
    const scans = await prisma.scan.findMany({
        orderBy: { createdAt: 'desc' },
    });

    // Serialize dates for client component
    const serializedScans = scans.map(scan => ({
        ...scan,
        createdAt: scan.createdAt.toISOString()
    }));

    return <ScansClient initialScans={serializedScans} />;
}
