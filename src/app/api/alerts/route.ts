import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

export async function GET() {
    try {
        const alerts = await prisma.alert.findMany({
            orderBy: { createdAt: 'desc' },
            take: 20
        });
        return NextResponse.json({ alerts });
    } catch (error) {
        console.error('Alerts GET error:', error);
        return NextResponse.json({ alerts: [] });
    }
}

export async function POST(req: Request) {
    try {
        const { id, read } = await req.json();
        const alert = await prisma.alert.update({
            where: { id },
            data: { read }
        });
        return NextResponse.json(alert);
    } catch (error) {
        console.error('Alerts POST error:', error);
        return NextResponse.json({ error: 'Failed to update alert' }, { status: 500 });
    }
}

export async function DELETE(req: Request) {
    try {
        const { id } = await req.json();
        await prisma.alert.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Alerts DELETE error:', error);
        return NextResponse.json({ error: 'Failed to delete alert' }, { status: 500 });
    }
}
