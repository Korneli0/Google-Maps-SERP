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
    try {
        const body = await req.json();
        const { url, businessName, totalReviews, averageRating, placeId } = body;

        if (!url || typeof url !== 'string') {
            return NextResponse.json({ error: 'Business URL is required' }, { status: 400 });
        }

        // Create the analysis record with confirmed business info
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

        // Run scraping + analysis in background
        runReviewAnalysis(analysis.id, url).catch(async (err) => {
            console.error(`[REVIEW] Background analysis failed for ${analysis.id}:`, err);
            try {
                await db.reviewAnalysis.update({
                    where: { id: analysis.id },
                    data: { status: 'FAILED', error: err?.message || 'Unknown error' },
                });
            } catch { /* ignore */ }
        });

        return NextResponse.json(analysis);
    } catch (error: any) {
        console.error('POST /api/reviews error:', error);
        return NextResponse.json({ error: 'Failed to start analysis', details: error.message }, { status: 500 });
    }
}

async function runReviewAnalysis(analysisId: string, url: string) {
    try {
        console.log(`[REVIEW] Starting scrape for ${analysisId}...`);

        const { scrapeGoogleReviews } = await import('@/lib/reviewScraper');
        const { analyzeReviews } = await import('@/lib/reviewAnalyzer');

        const { business, reviews } = await scrapeGoogleReviews(url);

        await db.reviewAnalysis.update({
            where: { id: analysisId },
            data: {
                businessName: business.name,
                totalReviews: business.totalReviews,
                averageRating: business.averageRating,
                placeId: business.placeId,
                status: 'ANALYZING',
            },
        });

        console.log(`[REVIEW] Saving ${reviews.length} reviews...`);
        for (const review of reviews) {
            await db.review.create({
                data: {
                    analysisId,
                    reviewerName: review.reviewerName,
                    reviewerUrl: review.reviewerUrl,
                    localGuideLevel: review.localGuideLevel,
                    reviewCount: review.reviewCount,
                    photoCount: review.photoCount,
                    rating: review.rating,
                    text: review.text,
                    publishedDate: review.publishedDate,
                    responseText: review.responseText,
                    responseDate: review.responseDate,
                },
            });
        }

        console.log(`[REVIEW] Running 150+ metric deep analysis...`);
        const analysisResult = analyzeReviews(reviews);

        // Sentiment enrichment per review using new hybrid engine
        const { analyzeSentiment } = await import('@/lib/sentimentEngine');
        const dbReviews = await db.review.findMany({ where: { analysisId } });

        for (let i = 0; i < Math.min(dbReviews.length, reviews.length); i++) {
            const r = reviews[i];
            const sent = analyzeSentiment(r.text, r.rating);

            // Fake score calculation with detailed reasons
            let fakeScore = 0;
            const fakeReasons: string[] = [];
            if (!r.text || r.text.length < 20) { fakeScore += 15; fakeReasons.push('No/minimal text'); }
            if (!r.localGuideLevel) { fakeScore += 10; fakeReasons.push('Not a Local Guide'); }
            if (r.reviewCount !== undefined && r.reviewCount <= 1) { fakeScore += 20; fakeReasons.push('Single-review account'); }
            if (!r.photoCount) { fakeScore += 5; fakeReasons.push('No photos uploaded'); }
            if ((r.rating === 1 || r.rating === 5) && (!r.text || r.text.length < 30)) { fakeScore += 10; fakeReasons.push('Extreme rating with minimal text'); }
            if (r.text && r.rating === 5 && sent.label === 'NEGATIVE') { fakeScore += 15; fakeReasons.push('5-star but negative text (inconsistent)'); }
            if (r.text && r.rating === 1 && sent.label === 'POSITIVE') { fakeScore += 15; fakeReasons.push('1-star but positive text (inconsistent)'); }

            await db.review.update({
                where: { id: dbReviews[i].id },
                data: {
                    sentimentScore: sent.compound,
                    sentimentLabel: sent.label,
                    fakeScore: Math.min(fakeScore, 100),
                    isLikelyFake: fakeScore >= 50,
                },
            });
        }

        await db.reviewAnalysis.update({
            where: { id: analysisId },
            data: {
                analysisData: JSON.stringify(analysisResult),
                status: 'COMPLETED',
            },
        });

        console.log(`[REVIEW] ✅ Completed: "${business.name}" (${reviews.length} reviews)`);

    } catch (error: any) {
        console.error(`[REVIEW] ❌ Error:`, error);
        await db.reviewAnalysis.update({
            where: { id: analysisId },
            data: { status: 'FAILED', error: error?.message || 'Unknown analysis error' },
        });
    }
}
