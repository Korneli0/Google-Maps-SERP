import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { runScan } from '@/lib/scanner';

export async function GET() {
    try {
        const now = new Date();
        const missedScans = await prisma.scan.findMany({
            where: {
                nextRun: {
                    lt: now
                },
                status: 'COMPLETED', // Or PENDING if it never started
                frequency: {
                    not: 'ONCE'
                }
            },
            orderBy: { nextRun: 'asc' }
        });

        return NextResponse.json({ missedScans });
    } catch (error) {
        console.error('Lookback check error:', error);
        return NextResponse.json({ missedScans: [] });
    }
}

export async function POST(req: Request) {
    try {
        const { scanIds } = await req.json();

        for (const id of scanIds) {
            // Trigger scan immediately
            runScan(id).catch(console.error);
        }

        return NextResponse.json({ success: true, count: scanIds.length });
    } catch (error) {
        console.error('Lookback execution error:', error);
        return NextResponse.json({ error: 'Failed to run missed scans' }, { status: 500 });
    }
}
