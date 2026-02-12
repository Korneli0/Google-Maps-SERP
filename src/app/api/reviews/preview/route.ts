import { NextResponse } from 'next/server';
import { chromium } from 'playwright';

/**
 * Preview a business from a Google Maps URL — fetches name, rating, total reviews
 * WITHOUT scraping all reviews. Used for the confirmation step.
 */
export async function POST(req: Request) {
    let browser = null;

    try {
        const body = await req.json();
        const url = body?.url;

        if (!url || typeof url !== 'string') {
            return NextResponse.json({ error: 'Business URL is required' }, { status: 400 });
        }

        browser = await chromium.launch({ headless: true });

        const context = await browser.newContext({
            viewport: { width: 1400, height: 900 },
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            locale: 'en-US',
            extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
            serviceWorkers: 'block',
        });

        const page = await context.newPage();

        // Force English & clean URL
        let targetUrl = url;
        try {
            const parsed = new URL(url);
            parsed.searchParams.set('hl', 'en');
            parsed.searchParams.set('gl', 'us');
            parsed.searchParams.delete('entry');
            parsed.searchParams.delete('g_ep');
            targetUrl = parsed.toString();
        } catch { /* use original */ }

        await page.goto(targetUrl, { waitUntil: 'load', timeout: 45000 });

        // Handle consent
        try {
            const consentBtn = page.locator('button[aria-label="Accept all"], form[action*="consent"] button:last-child');
            if (await consentBtn.first().isVisible({ timeout: 3000 })) {
                await consentBtn.first().click();
                await page.waitForTimeout(2000);
            }
        } catch { /* no consent needed */ }

        // Wait for the business panel to render
        try {
            await page.waitForSelector('h1.DUwDvf, h1 span', { timeout: 15000 });
        } catch {
            await page.waitForTimeout(5000);
        }

        // Extract basic business info
        const business = await page.evaluate(() => {
            const nameEl = document.querySelector('h1.DUwDvf, h1 span');
            const name = nameEl?.textContent?.trim() || 'Unknown Business';

            let averageRating = 0;
            const ratingEl = document.querySelector('div.F7nice span[aria-hidden="true"], span.ceNzKf, div.fontDisplayLarge');
            if (ratingEl) {
                averageRating = parseFloat(ratingEl.textContent?.replace(',', '.') || '0');
            }

            // Total reviews — multiple approaches
            let totalReviews = 0;

            // Approach 1: aria-label
            const reviewCountEl = document.querySelector('div.F7nice span[aria-label*="review"], span.RDApEe');
            if (reviewCountEl) {
                const match = reviewCountEl.textContent?.match(/[\d,.]+/);
                if (match) totalReviews = parseInt(match[0].replace(/[,.\.\s]/g, ''));
            }

            // Approach 2: number in parentheses like (1,700)
            if (totalReviews === 0) {
                const allSpans = document.querySelectorAll('div.F7nice span, span.RDApEe, button[jsaction*="review"] span');
                for (const span of allSpans) {
                    const txt = span.textContent || '';
                    // Must be in parentheses to avoid matching the rating (4.3)
                    const m = txt.match(/\(([\d,.\.\u066c]+)\)/);
                    if (m) {
                        const num = parseInt(m[1].replace(/[^\d]/g, ''));
                        if (num >= 10 && num < 1000000) { totalReviews = num; break; }
                    }
                }
            }

            // Approach 3: tab button text
            if (totalReviews === 0) {
                const tabBtns = document.querySelectorAll('button[role="tab"]');
                for (const btn of tabBtns) {
                    const txt = btn.textContent || '';
                    const m = txt.match(/([\d,.\.]+)/);
                    if (m) {
                        const num = parseInt(m[1].replace(/[^\d]/g, ''));
                        if (num > 10) { totalReviews = num; break; }
                    }
                }
            }

            let placeId = '';
            const placeMatch = window.location.href.match(/!1s(ChIJ[A-Za-z0-9_-]+)/);
            if (placeMatch) placeId = placeMatch[1];
            const cidMatch = window.location.href.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/);
            if (!placeId && cidMatch) placeId = cidMatch[1];

            // Get address
            const addressEl = document.querySelector('button[data-item-id="address"] div.fontBodyMedium, div.rogA2c div.Io6YTe');
            const address = addressEl?.textContent?.trim() || '';

            // Get category
            const categoryEl = document.querySelector('button.DkEaL, span.DkEaL');
            const category = categoryEl?.textContent?.trim() || '';

            return {
                name,
                averageRating,
                totalReviews,
                placeId: placeId || undefined,
                address,
                category,
            };
        });

        return NextResponse.json(business);

    } catch (error: any) {
        console.error('Preview error:', error);
        return NextResponse.json(
            { error: 'Failed to preview business. Please check the URL and try again.', details: error.message },
            { status: 500 }
        );
    } finally {
        if (browser) await browser.close();
    }
}
