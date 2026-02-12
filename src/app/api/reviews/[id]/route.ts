import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

export async function GET(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const analysis = await db.reviewAnalysis.findUnique({
            where: { id },
            include: {
                reviews: {
                    orderBy: { rating: 'asc' },
                },
            },
        });

        if (!analysis) {
            return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
        }

        return NextResponse.json(analysis);
    } catch (error: any) {
        console.error('GET /api/reviews/[id] error:', error);
        return NextResponse.json({ error: 'Failed to fetch analysis', details: error.message }, { status: 500 });
    }
}

export async function DELETE(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        await db.reviewAnalysis.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch (error: any) {
        return NextResponse.json({ error: 'Failed to delete analysis', details: error.message }, { status: 500 });
    }
}
