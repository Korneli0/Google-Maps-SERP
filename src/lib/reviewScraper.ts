import { chromium, Browser, Page, BrowserContext } from 'playwright';
import { logger } from './logger';

export interface ScrapedReview {
    reviewId?: string;
    reviewerName: string;
    reviewerUrl?: string;
    reviewImage?: string;
    reviewCount?: number;
    photoCount?: number;
    rating: number;
    text?: string;
    publishedDate?: string;
    responseText?: string;
    responseDate?: string;
}

export interface ScrapedBusinessInfo {
    name: string;
    averageRating: number;
    totalReviews: number;
    placeId?: string;
}

/**
 * Scrapes all Google reviews for a business from its Google Maps URL.
 */
export async function scrapeGoogleReviews(
    businessUrl: string,
    onProgress?: (msg: string) => void
): Promise<{ business: ScrapedBusinessInfo; reviews: ScrapedReview[] }> {
    let browser: Browser | null = null;

    const log = (msg: string) => {
        onProgress?.(msg);
        logger.info(msg, 'REVIEW_SCRAPER');
    };

    try {
        log('Launching browser...');
        browser = await chromium.launch({ headless: true });

        const context = await browser.newContext({
            viewport: { width: 1400, height: 900 },
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            locale: 'en-US',
            extraHTTPHeaders: {
                'Accept-Language': 'en-US,en;q=0.9',
            },
            serviceWorkers: 'block',
        });

        const page = await context.newPage();

        // Clean and force English on URL
        let targetUrl = businessUrl;
        try {
            const parsed = new URL(businessUrl);
            parsed.searchParams.set('hl', 'en');
            parsed.searchParams.set('gl', 'us');
            // Remove tracking params that can interfere
            parsed.searchParams.delete('entry');
            parsed.searchParams.delete('g_ep');
            targetUrl = parsed.toString();
        } catch { /* use original */ }

        // Retry wrapper — attempt up to 3 times with full re-navigation
        let lastError: Error | null = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                if (attempt > 1) {
                    log(`Retry attempt ${attempt}/3...`);
                }

                log('Navigating to business page...');
                await page.goto(targetUrl, { waitUntil: 'load', timeout: 45000 });

                // Handle consent dialog
                try {
                    const consentBtn = page.locator('button[aria-label="Accept all"], form[action*="consent"] button:last-child');
                    if (await consentBtn.first().isVisible({ timeout: 3000 })) {
                        await consentBtn.first().click();
                        await page.waitForTimeout(2000);
                    }
                } catch { /* no consent needed */ }

                // Wait for the Google Maps business panel to actually render
                log('Waiting for business panel to render...');
                try {
                    await page.waitForSelector('h1.DUwDvf, h1 span', { timeout: 15000 });
                } catch {
                    log('Business name element not found — waiting longer...');
                    await page.waitForTimeout(5000);
                }

                // Extract business info
                log('Extracting business info...');
                let business = await extractBusinessInfo(page);
                log(`Found: "${business.name}", ${business.averageRating}★, ${business.totalReviews} reviews`);

                // If totalReviews is 0, the page might still be loading — wait and retry extraction
                if (business.totalReviews === 0) {
                    log('⚠️ totalReviews is 0 — waiting for full render...');
                    await page.waitForTimeout(5000);
                    business = await extractBusinessInfo(page);
                    log(`Re-extracted: "${business.name}", ${business.averageRating}★, ${business.totalReviews} reviews`);
                }

                // Click the Reviews tab
                log('Opening reviews tab...');
                await openReviewsTab(page);

                // Wait for review elements to appear after clicking the tab
                log('Waiting for review elements to load...');
                try {
                    await page.waitForSelector('div[data-review-id], div.jftiEf', { timeout: 15000 });
                    log('Review elements detected.');
                } catch {
                    log('Review elements not found via waitForSelector — trying extra wait...');
                    await page.waitForTimeout(5000);
                }

                // Sort by newest to get chronological data
                log('Sorting reviews by newest...');
                await sortReviewsByNewest(page);

                // Verify we can see review elements
                await page.waitForTimeout(2000);
                const initialCount = await page.evaluate(() =>
                    document.querySelectorAll('div[data-review-id], div.jftiEf, div.jJc9Ad').length
                );
                log(`Review elements visible: ${initialCount}`);

                if (initialCount === 0) {
                    // Debug: log what IS on the page
                    const debugInfo = await page.evaluate(() => ({
                        title: document.title,
                        h1: document.querySelector('h1')?.textContent || 'none',
                        bodyLen: document.body?.innerHTML?.length || 0,
                        tabCount: document.querySelectorAll('button[role="tab"]').length,
                        scrollContainer: !!document.querySelector('div.m6QErb'),
                    }));
                    log(`Debug: title="${debugInfo.title}", h1="${debugInfo.h1}", bodyLen=${debugInfo.bodyLen}, tabs=${debugInfo.tabCount}, scrollContainer=${debugInfo.scrollContainer}`);
                    throw new Error(`No review elements found (attempt ${attempt})`);
                }

                // Scroll and collect all reviews
                const target = business.totalReviews || 100;
                log(`Scrolling to load all ${target} reviews (this may take a while)...`);
                const reviews = await scrollAndCollectReviews(page, target, log);

                if (reviews.length === 0) {
                    throw new Error('Scraped 0 reviews — DOM selectors may have changed');
                }

                log(`Successfully scraped ${reviews.length} reviews for "${business.name}"`);
                return { business, reviews };

            } catch (err: any) {
                lastError = err;
                log(`Attempt ${attempt} failed: ${err.message}`);
                if (attempt >= 3) break;
                // Wait before retry
                await page.waitForTimeout(3000);
            }
        }

        throw lastError || new Error('Failed to scrape reviews after retries');

    } finally {
        if (browser) await browser.close();
    }
}

async function extractBusinessInfo(page: Page): Promise<ScrapedBusinessInfo> {
    return await page.evaluate(() => {
        const nameEl = document.querySelector('h1.DUwDvf, h1 span');
        const name = nameEl?.textContent?.trim() || 'Unknown Business';

        // Rating — try multiple selectors
        let averageRating = 0;
        const ratingEl = document.querySelector('div.F7nice span[aria-hidden="true"], span.ceNzKf, div.fontDisplayLarge');
        if (ratingEl) {
            // Handle both "4.3" and "4,3" formats
            averageRating = parseFloat(ratingEl.textContent?.replace(',', '.') || '0');
        }

        // Total reviews — try multiple approaches
        let totalReviews = 0;

        // Approach 1: Primary aria-label or specific span
        const reviewCountEl = document.querySelector('div.F7nice span[aria-label*="review"], span.RDApEe, button[jsaction*="review.list"] span.D67Sbc');
        if (reviewCountEl) {
            const match = reviewCountEl.textContent?.replace(/[^\d]/g, '');
            if (match) totalReviews = parseInt(match);
        }

        // Approach 2: Deep search in common containers
        if (totalReviews === 0) {
            const containers = ['div.F7nice', 'div.jANrlb', 'div.TIvO8b', 'button[jsaction*="review"]'];
            for (const sel of containers) {
                const el = document.querySelector(sel);
                if (!el) continue;
                const txt = el.textContent || '';
                const m = txt.match(/\(([\d,.\s]+)\)/) || txt.match(/([\d,.\s]+)\s*(?:reviews|Critiques|Bewertungen)/i);
                if (m) {
                    const num = parseInt(m[1].replace(/[^\d]/g, ''));
                    if (num > 0 && num < 1000000) { totalReviews = num; break; }
                }
            }
        }

        // Approach 3: Try the reviews tab button text — often shows "Reviews (1,700)"
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

        // Place ID from URL
        let placeId = '';
        const placeMatch = window.location.href.match(/!1s(ChIJ[A-Za-z0-9_-]+)/);
        if (placeMatch) placeId = placeMatch[1];
        const cidMatch = window.location.href.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/);
        if (!placeId && cidMatch) placeId = cidMatch[1];

        return { name, averageRating, totalReviews, placeId: placeId || undefined };
    });
}

async function openReviewsTab(page: Page): Promise<void> {
    // Try clicking the reviews tab button — multiple approaches
    try {
        const reviewTab = page.locator('button[aria-label*="Reviews"], button[aria-label*="reviews"], button[data-tab-id="reviews"]');
        if (await reviewTab.first().isVisible({ timeout: 3000 })) {
            await reviewTab.first().click();
            await page.waitForTimeout(2000);
            return;
        }
    } catch { /* fallback below */ }

    // Fallback 1: Try all tab buttons and find one with a number (review count)
    try {
        const tabs = page.locator('button[role="tab"]');
        const count = await tabs.count();
        for (let i = 0; i < count; i++) {
            const text = await tabs.nth(i).textContent() || '';
            // Reviews tab usually has a number and is the 2nd or 3rd tab
            if (/\d/.test(text) && (text.toLowerCase().includes('review') || i === 1)) {
                await tabs.nth(i).click();
                await page.waitForTimeout(2000);
                return;
            }
        }
        // If no match found, just click the 2nd tab (usually Reviews)
        if (count >= 2) {
            await tabs.nth(1).click();
            await page.waitForTimeout(2000);
            return;
        }
    } catch { /* fallback below */ }

    // Fallback 2: click on the review count text
    try {
        const reviewLink = page.locator('span[aria-label*="review"], span[aria-label*="Review"]').first();
        if (await reviewLink.isVisible({ timeout: 3000 })) {
            await reviewLink.click();
            await page.waitForTimeout(2000);
        }
    } catch { /* reviews may already be visible */ }
}

async function sortReviewsByNewest(page: Page): Promise<void> {
    try {
        // Click the sort button
        const sortBtn = page.locator('button[aria-label="Sort reviews"], button[data-value="Sort"]');
        if (await sortBtn.first().isVisible({ timeout: 5000 })) {
            await sortBtn.first().click();
            await page.waitForTimeout(1000);

            // Click "Newest"
            const newestOption = page.locator('div[role="menuitemradio"]:has-text("Newest"), li[data-index="1"]');
            if (await newestOption.first().isVisible({ timeout: 3000 })) {
                await newestOption.first().click();
                await page.waitForTimeout(2000);
            }
        }
    } catch {
        // Continue without sorting — default "Most Relevant" is still usable
    }
}

async function scrollAndCollectReviews(
    page: Page,
    expectedTotal: number,
    log: (msg: string) => void
): Promise<ScrapedReview[]> {
    const maxScrollAttempts = Math.min(expectedTotal * 3, 3000); // Higher cap for large businesses
    let lastCount = 0;
    let noNewReviewsCount = 0;

    // Find the scrollable reviews container
    const scrollContainerSelector = 'div.m6QErb.DxyBCb.kA9KIf.dS8AEf, div.m6QErb.DxyBCb';

    for (let i = 0; i < maxScrollAttempts; i++) {
        // Scroll the reviews panel
        await page.evaluate((selector) => {
            const el = document.querySelector(selector);
            if (el) el.scrollTop = el.scrollHeight;
        }, scrollContainerSelector);

        await page.waitForTimeout(800);

        // Expand "More" buttons on reviews to get full text
        if (i % 5 === 0) {
            await page.evaluate(() => {
                document.querySelectorAll('button.w8nwRe.kyuRq').forEach(btn => {
                    if (btn.textContent?.includes('More')) (btn as HTMLElement).click();
                });
            });
        }

        // Check current count — count UNIQUE review IDs to avoid double-counting nested elements
        const currentCount = await page.evaluate(() => {
            const withId = document.querySelectorAll('div[data-review-id]');
            if (withId.length > 0) {
                const uniqueIds = new Set<string>();
                withId.forEach(el => {
                    const id = el.getAttribute('data-review-id');
                    if (id) uniqueIds.add(id);
                });
                return uniqueIds.size;
            }
            return document.querySelectorAll('div.jftiEf, div.jJc9Ad').length;
        });

        if (i % 10 === 0) {
            log(`Loaded ${currentCount} / ~${expectedTotal} reviews...`);
        }

        if (currentCount === lastCount) {
            noNewReviewsCount++;

            // "Jiggle" the scroll to trigger lazy loading if stuck
            if (noNewReviewsCount > 5) {
                await page.evaluate((selector) => {
                    const el = document.querySelector(selector);
                    if (el) {
                        el.scrollTop -= 500; // Scroll up a bit
                        setTimeout(() => { el.scrollTop += 500; }, 200); // Scroll back down
                    }
                }, scrollContainerSelector);
                await page.waitForTimeout(1000);
            }

            // High patience threshold for large lists
            if (noNewReviewsCount > 40) {
                log(`No new reviews loaded after ${noNewReviewsCount} attempts. Stopping at ${currentCount}.`);
                break;
            }
        } else {
            noNewReviewsCount = 0;
        }
        lastCount = currentCount;

        // If we've loaded enough, stop
        if (currentCount >= expectedTotal) {
            log(`All ${currentCount} reviews loaded.`);
            break;
        }
    }

    // Now extract all reviews from the page
    log('Extracting review data from page...');
    const rawReviews = await page.evaluate(() => {
        // Step 1: Collect review elements — only outermost data-review-id to avoid nested dupes
        const withId = document.querySelectorAll('div[data-review-id]');
        let reviewElements: Element[];

        if (withId.length > 0) {
            // Filter to only outermost elements (skip children whose parent also has data-review-id)
            const outermost: Element[] = [];
            const seenIds = new Set<string>();
            withId.forEach(el => {
                const id = el.getAttribute('data-review-id') || '';
                // Check if any ancestor also has data-review-id (meaning this is a nested child)
                let parent = el.parentElement;
                let isNested = false;
                while (parent) {
                    if (parent.hasAttribute('data-review-id')) {
                        isNested = true;
                        break;
                    }
                    parent = parent.parentElement;
                }
                if (!isNested && id && !seenIds.has(id)) {
                    seenIds.add(id);
                    outermost.push(el);
                }
            });
            reviewElements = outermost;
        } else {
            // Fallback: use class-based selectors, but filter out nested matches
            const candidates = document.querySelectorAll('div.jftiEf, div.jJc9Ad');
            const filtered: Element[] = [];
            candidates.forEach(el => {
                let dominated = false;
                for (const other of filtered) {
                    if (other.contains(el) && other !== el) { dominated = true; break; }
                }
                if (!dominated) {
                    for (let j = filtered.length - 1; j >= 0; j--) {
                        if (el.contains(filtered[j]) && el !== filtered[j]) {
                            filtered.splice(j, 1);
                        }
                    }
                    filtered.push(el);
                }
            });
            reviewElements = filtered;
        }

        const results: any[] = [];

        reviewElements.forEach((el) => {
            try {
                // Review ID (unique per review)
                const reviewId = el.getAttribute('data-review-id') || '';

                // Reviewer name
                const nameEl = el.querySelector('div.d4r55, button.WEBjve div.d4r55');
                const reviewerName = nameEl?.textContent?.trim() || 'Anonymous';

                // Reviewer profile URL
                const profileLink = el.querySelector('button.WEBjve');
                const reviewerUrl = profileLink?.getAttribute('data-href') || '';

                // Review Image (if any)
                // Look for a button with background-image style inside the review
                // Class `Tya61d` is common for attached photos
                let reviewImage = '';
                const imgBtn = el.querySelector('button.Tya61d');
                if (imgBtn) {
                    const style = imgBtn.getAttribute('style') || '';
                    const match = style.match(/url\("?([^")]+)"?\)/);
                    if (match) reviewImage = match[1];
                }

                // Review/Photo counts (helpful context, keep for now)
                let reviewCount = 0;
                let photoCount = 0;

                // Attempt to parse "X reviews" text if present
                const subText = el.textContent || '';
                const rc = subText.match(/(\d+)\s*reviews?/i);
                if (rc) reviewCount = parseInt(rc[1]);
                const pc = subText.match(/(\d+)\s*photos?/i);
                if (pc) photoCount = parseInt(pc[1]);

                // Rating
                const ratingEl = el.querySelector('span.kvMYJc');
                const ratingAttr = ratingEl?.getAttribute('aria-label') || '';
                const ratingMatch = ratingAttr.match(/(\d)/);
                const rating = ratingMatch ? parseInt(ratingMatch[1]) : 0;

                // Review text
                const textEl = el.querySelector('span.wiI7pd');
                const text = textEl?.textContent?.trim() || '';

                // Published date
                const dateEl = el.querySelector('span.rsqaWe');
                const publishedDate = dateEl?.textContent?.trim() || '';

                // Owner response
                let responseText = '';
                let responseDate = '';
                const responseContainer = el.querySelector('div.CDe7pd');
                if (responseContainer) {
                    const respDateEl = responseContainer.querySelector('span.DZSIDd');
                    responseDate = respDateEl?.textContent?.trim() || '';
                    const respTextEl = responseContainer.querySelector('div.wiI7pd');
                    responseText = respTextEl?.textContent?.trim() || '';
                }

                if (rating > 0) {
                    results.push({
                        reviewId: reviewId || undefined,
                        reviewerName,
                        reviewerUrl: reviewerUrl || undefined,

                        reviewCount: reviewCount || undefined,
                        photoCount: photoCount || undefined,
                        rating,
                        text: text || undefined,
                        publishedDate: publishedDate || undefined,
                        responseText: responseText || undefined,
                        responseDate: responseDate || undefined,
                    });
                }
            } catch (err) {
                // Skip malformed review elements
            }
        });

        return results;
    });

    // Post-extraction deduplication — only dedup by reviewId (guaranteed unique from Google)
    // DO NOT dedup by name/rating/text — different people can share names and ratings
    const seen = new Set<string>();
    const dedupedReviews: ScrapedReview[] = [];

    for (const r of rawReviews) {
        if (r.reviewId) {
            // Only dedup reviews that have a Google review ID
            const key = `id:${r.reviewId}`;
            if (!seen.has(key)) {
                seen.add(key);
                dedupedReviews.push(r as ScrapedReview);
            }
        } else {
            // No reviewId — always keep (they came from unique DOM elements)
            dedupedReviews.push(r as ScrapedReview);
        }
    }

    const dupeCount = rawReviews.length - dedupedReviews.length;
    if (dupeCount > 0) {
        log(`Removed ${dupeCount} duplicate reviews (${rawReviews.length} raw → ${dedupedReviews.length} unique)`);
    }

    return dedupedReviews;
}
