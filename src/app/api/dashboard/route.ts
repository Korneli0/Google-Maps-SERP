import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

export async function GET() {
    try {
        const scansCount = await prisma.scan.count();
        const completedScans = await prisma.scan.count({ where: { status: 'COMPLETED' } });
        const activeScans = await prisma.scan.count({ where: { status: { in: ['RUNNING', 'PENDING'] } } });
        const recentScans = await prisma.scan.findMany({
            orderBy: { createdAt: 'desc' },
            take: 5,
        });

        return NextResponse.json({ scansCount, completedScans, activeScans, recentScans });
    } catch (error) {
        console.error('Dashboard API error:', error);
        return NextResponse.json({ scansCount: 0, completedScans: 0, activeScans: 0, recentScans: [] });
    }
}
