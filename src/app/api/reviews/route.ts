import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

// Use a dedicated client to avoid any global caching issues
const db = new PrismaClient();

export async function GET() {
    try {
        const analyses = await db.reviewAnalysis.findMany({
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                businessName: true,
                businessUrl: true,
                totalReviews: true,
                averageRating: true,
                status: true,
                error: true,
                createdAt: true,
            }
        });
        return NextResponse.json(analyses);
    } catch (error: any) {
        console.error('GET /api/reviews error:', error);
        return NextResponse.json([], { status: 200 });
    }
}

export async function POST(req: Request) {
    const encoder = new TextEncoder();
    const customReadable = new TransformStream();
    const writer = customReadable.writable.getWriter();

    // Helper to send progress logs
    const sendLog = async (msg: string, type: 'info' | 'error' | 'success' = 'info') => {
        try {
            await writer.write(encoder.encode(`data: ${JSON.stringify({ msg, type })}\n\n`));
        } catch { /* connection closed */ }
    };

    // Helper to send final result
    const sendResult = async (data: any) => {
        try {
            await writer.write(encoder.encode(`data: ${JSON.stringify({ result: data, type: 'complete' })}\n\n`));
            await writer.close();
        } catch { /* connection closed */ }
    };

    // Run analysis loosely detached but piping logs
    (async () => {
        try {
            const body = await req.json();
            const { url, businessName, totalReviews, averageRating, placeId } = body;

            if (!url || typeof url !== 'string') {
                await sendLog('Business URL is required', 'error');
                await writer.close();
                return;
            }

            // Create entry
            await sendLog(`Creating analysis record for "${businessName}"...`);
            const analysis = await db.reviewAnalysis.create({
                data: {
                    businessName: businessName || 'Unknown Business',
                    businessUrl: url,
                    totalReviews: totalReviews || 0,
                    averageRating: averageRating || 0,
                    placeId: placeId || null,
                    status: 'SCRAPING',
                },
            });

            // Start scraping
            await sendLog(`Starting scrape for ${url}...`);
            const { scrapeGoogleReviews } = await import('@/lib/reviewScraper');

            // Pass a progress callback that writes to the stream
            const onProgress = (msg: string) => sendLog(msg);

            const { business, reviews } = await scrapeGoogleReviews(url, onProgress);

            await sendLog(`Scraped ${reviews.length} reviews. Saving to database...`);
            await db.reviewAnalysis.update({
                where: { id: analysis.id },
                data: {
                    businessName: business.name,
                    totalReviews: business.totalReviews,
                    averageRating: business.averageRating,
                    placeId: business.placeId,
                    status: 'ANALYZING',
                },
            });

            // Save reviews in chunks to report progress
            const chunkSize = 100;
            for (let i = 0; i < reviews.length; i += chunkSize) {
                const chunk = reviews.slice(i, i + chunkSize);
                await db.review.createMany({
                    data: chunk.map(r => ({
                        analysisId: analysis.id,
                        reviewerName: r.reviewerName,
                        reviewerUrl: r.reviewerUrl,
                        reviewImage: r.reviewImage,
                        reviewCount: r.reviewCount,
                        photoCount: r.photoCount,
                        rating: r.rating,
                        text: r.text,
                        publishedDate: r.publishedDate,
                        responseText: r.responseText,
                        responseDate: r.responseDate,
                    }))
                });
                await sendLog(`Saved ${Math.min(i + chunkSize, reviews.length)} / ${reviews.length} reviews...`);
            }

            await sendLog('Running 150+ metric deep analysis...');
            const { analyzeReviews } = await import('@/lib/reviewAnalyzer');
            const analysisResult = analyzeReviews(reviews);

            // Sentiment enrichment
            await sendLog('Analyzing sentiment and fake patterns...');
            const { analyzeSentiment } = await import('@/lib/sentimentEngine');
            const dbReviews = await db.review.findMany({
                where: { analysisId: analysis.id },
                select: { id: true, text: true, rating: true, reviewCount: true, photoCount: true }
            });

            for (let i = 0; i < dbReviews.length; i++) {
                const r = dbReviews[i];
                const sent = analyzeSentiment(r.text, r.rating);

                // Fake score calculation
                let fakeScore = 0;
                if (!r.text || r.text.length < 20) fakeScore += 15;
                // if (!r.localGuideLevel) fakeScore += 10; // Removed: LG check unreliable without deep scrape
                if (r.reviewCount !== undefined && r.reviewCount <= 1) fakeScore += 20;
                if (!r.photoCount) fakeScore += 5;
                if ((r.rating === 1 || r.rating === 5) && (!r.text || r.text.length < 30)) fakeScore += 10;
                if (r.text && r.rating === 5 && sent.label === 'NEGATIVE') fakeScore += 15;
                if (r.text && r.rating === 1 && sent.label === 'POSITIVE') fakeScore += 15;

                await db.review.update({
                    where: { id: r.id },
                    data: {
                        sentimentScore: sent.compound,
                        sentimentLabel: sent.label,
                        fakeScore: Math.min(fakeScore, 100),
                        isLikelyFake: fakeScore >= 50,
                    },
                });

                if (i % 200 === 0) await sendLog(`Analyzed ${i} / ${dbReviews.length} reviews...`);
            }

            await db.reviewAnalysis.update({
                where: { id: analysis.id },
                data: {
                    analysisData: JSON.stringify(analysisResult),
                    status: 'COMPLETED',
                },
            });

            await sendLog(`Analysis complete! Redirecting...`, 'success');
            await sendResult(analysis);

        } catch (error: any) {
            console.error('Stream error:', error);
            await sendLog(`Error: ${error.message}`, 'error');
            await writer.close();
        }
    })();

    return new NextResponse(customReadable.readable, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        },
    });
}
