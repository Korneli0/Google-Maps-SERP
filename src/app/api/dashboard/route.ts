import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

export async function GET() {
    try {
        const scansCount = await prisma.scan.count();
        const recentScans = await prisma.scan.findMany({
            orderBy: { createdAt: 'desc' },
            take: 5,
        });

        return NextResponse.json({ scansCount, recentScans });
    } catch (error) {
        console.error('Dashboard API error:', error);
        return NextResponse.json({ scansCount: 0, recentScans: [] });
    }
}
