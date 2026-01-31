import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

export async function GET() {
    try {
        const settings = await prisma.globalSetting.findMany();
        const settingsMap = settings.reduce((acc, curr) => {
            acc[curr.key] = curr.value;
            return acc;
        }, {} as Record<string, string>);

        return NextResponse.json({ settings: settingsMap });
    } catch (error) {
        console.error('Settings GET error:', error);
        return NextResponse.json({ settings: {} });
    }
}

export async function POST(req: Request) {
    try {
        const { key, value } = await req.json();

        const setting = await prisma.globalSetting.upsert({
            where: { key },
            update: { value: String(value) },
            create: { key, value: String(value) },
        });

        return NextResponse.json(setting);
    } catch (error) {
        console.error('Setting update error:', error);
        return NextResponse.json({ error: 'Failed to update setting' }, { status: 500 });
    }
}
