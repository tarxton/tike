/**
 * Crawl one shop: discover product URLs from its sitemap, fetch and parse each page,
 * and write offers with their per-size availability.
 *
 * Invoked locally as `pnpm crawl <shop-slug> [--limit N]` and by GitHub Actions on a
 * schedule. The processor logic lives here so moving to a queue later changes only the
 * trigger.
 */

import { eq, sql } from 'drizzle-orm';
import { normalizeOffer, NormalizationError } from '@tike/core';
import { crawlConfigSchema } from '@tike/contracts';
import {
  ForbiddenError,
  ParseError,
  PoliteFetcher,
  filterByPath,
  isSitemapIndex,
  parseSitemapLocs,
  parserFor,
  selectProductSitemap,
} from '@tike/crawler';
import { crawlRun, offer, offerSize, pricePoint, shop, withDb } from '@tike/db';

/**
 * If more than this share of pages fail to parse, the run aborts without writing.
 * A silently broken selector would otherwise mark an entire shop out of stock, which
 * looks exactly like a real stock-out and destroys trust in the data.
 */
const PARSE_FAILURE_THRESHOLD = 0.05;
/** Below this many pages the ratio is meaningless, so the breaker stays out of the way. */
const MIN_PAGES_FOR_THRESHOLD = 20;

const args = process.argv.slice(2);
const shopSlug = args.find((a) => !a.startsWith('--'));
const limitArg = args.find((a) => a.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : Infinity;
const dryRun = args.includes('--dry-run');

if (!shopSlug) {
  console.error('usage: pnpm crawl <shop-slug> [--limit=N] [--dry-run]');
  process.exit(1);
}

await withDb(async (db) => {
  const [row] = await db.select().from(shop).where(eq(shop.slug, shopSlug)).limit(1);
  if (!row) throw new Error(`unknown shop "${shopSlug}" — seed it first`);
  if (!row.active) throw new Error(`shop "${shopSlug}" is inactive; refusing to crawl`);
  if (!row.sitemapUrl) throw new Error(`shop "${shopSlug}" has no sitemap configured`);

  const fetcher = new PoliteFetcher(row.baseUrl, row.minDelayMs);
  const { crawlDelayMs, effectiveDelayMs } = await fetcher.init();
  console.log(
    `shop=${row.slug} platform=${row.platform} robots crawl-delay=${crawlDelayMs}ms ` +
      `effective delay=${effectiveDelayMs}ms`,
  );

  // Resolve the sitemap index down to the product sitemap.
  let sitemapXml = await fetcher.get(row.sitemapUrl);
  if (isSitemapIndex(sitemapXml)) {
    const productSitemap = selectProductSitemap(parseSitemapLocs(sitemapXml));
    if (!productSitemap) throw new Error('sitemap index contains no product.xml');
    console.log(`sitemap index -> ${productSitemap}`);
    sitemapXml = await fetcher.get(productSitemap);
  }

  const allUrls = parseSitemapLocs(sitemapXml);
  // Shops list their whole catalogue; keep only the categories tike covers. Apparel is
  // out of scope, not a parse failure, so it must be excluded before fetching.
  const config = crawlConfigSchema.parse(row.crawlConfig ?? {});
  const inScope = filterByPath(allUrls, config.pathAllow);
  const urls = inScope.slice(0, Number.isFinite(limit) ? limit : undefined);
  console.log(
    `sitemap lists ${allUrls.length} urls; ${inScope.length} in scope ` +
      `(${config.pathAllow.join(', ') || 'no filter'}); crawling ${urls.length}`,
  );

  const [run] = await db
    .insert(crawlRun)
    .values({ shopId: row.id, status: 'running', urlsSeen: urls.length })
    .returning({ id: crawlRun.id });
  const runId = run!.id;

  const parse = parserFor(row.platform);
  const failures: { url: string; reason: string }[] = [];
  let parsed = 0;
  let changed = 0;

  for (const [i, url] of urls.entries()) {
    if (!fetcher.isAllowed(url)) {
      console.warn(`skipped (robots): ${url}`);
      continue;
    }
    try {
      const html = await fetcher.get(url);
      const normalized = normalizeOffer(parse(html, url));
      parsed += 1;

      if (dryRun) {
        console.log(
          `  [${i + 1}/${urls.length}] ${normalized.brand} ${normalized.model} — ` +
            `${normalized.sizes.length} sizes, ${normalized.sizes.filter((s) => s.inStock).length} in stock`,
        );
        continue;
      }

      // One transaction per offer: the offer and its sizes land together or not at all.
      await db.transaction(async (tx) => {
        const [saved] = await tx
          .insert(offer)
          .values({
            shopId: row.id,
            externalId: normalized.externalId,
            url: normalized.url,
            title: normalized.title,
            rawBrand: normalized.brand,
            sku: normalized.sku,
            imageUrl: normalized.imageUrl,
            gender: normalized.gender,
            priceMinor: normalized.price.amountMinor,
            originalPriceMinor: normalized.originalPrice?.amountMinor ?? null,
            currency: normalized.price.currency,
            inStock: normalized.inStock,
          })
          .onConflictDoUpdate({
            target: [offer.shopId, offer.externalId],
            set: {
              url: normalized.url,
              title: normalized.title,
              rawBrand: normalized.brand,
              sku: normalized.sku,
              imageUrl: normalized.imageUrl,
              gender: normalized.gender,
              priceMinor: normalized.price.amountMinor,
              originalPriceMinor: normalized.originalPrice?.amountMinor ?? null,
              inStock: normalized.inStock,
              lastSeenAt: sql`now()`,
            },
          })
          .returning({ id: offer.id, priceMinor: offer.priceMinor });

        const offerId = saved!.id;

        // Sizes are replaced wholesale: the page is the source of truth for what the
        // shop sells today, and a size that disappeared should not linger.
        await tx.delete(offerSize).where(eq(offerSize.offerId, offerId));
        await tx.insert(offerSize).values(
          normalized.sizes.map((s) => ({
            offerId,
            sizeRaw: s.sizeRaw,
            sizeEu: s.sizeEu,
            sizeUs: s.sizeUs,
            sizeUk: s.sizeUk,
            inStock: s.inStock,
          })),
        );

        // Price history: only append when the price actually moved.
        const [last] = await tx
          .select({ priceMinor: pricePoint.priceMinor })
          .from(pricePoint)
          .where(eq(pricePoint.offerId, offerId))
          .orderBy(sql`${pricePoint.recordedAt} desc`)
          .limit(1);
        if (!last || last.priceMinor !== normalized.price.amountMinor) {
          await tx.insert(pricePoint).values({
            offerId,
            priceMinor: normalized.price.amountMinor,
            currency: normalized.price.currency,
          });
        }
      });
      changed += 1;
    } catch (err) {
      if (err instanceof ForbiddenError) throw err; // stop the whole run
      // Only bad *data* counts toward the failure budget. A database or network error
      // is a bug or an outage, not a shop changing its markup, and hiding it in the
      // parse-failure count would let the circuit breaker measure the wrong thing.
      const isDataProblem = err instanceof NormalizationError || err instanceof ParseError;
      if (!isDataProblem) throw err;
      failures.push({ url, reason: err.message.slice(0, 200) });
      console.warn(`  parse failure: ${url} — ${err.message.slice(0, 120)}`);
    }
  }

  const attempted = parsed + failures.length;
  const failureRate = attempted === 0 ? 1 : failures.length / attempted;
  const breakerTripped =
    attempted >= MIN_PAGES_FOR_THRESHOLD && failureRate > PARSE_FAILURE_THRESHOLD;

  await db
    .update(crawlRun)
    .set({
      finishedAt: sql`now()`,
      status: breakerTripped ? 'aborted_parse_threshold' : 'ok',
      urlsParsed: parsed,
      parseFailures: failures.length,
      itemsChanged: changed,
      error: breakerTripped
        ? `parse failure rate ${(failureRate * 100).toFixed(1)}% exceeded threshold`
        : null,
    })
    .where(eq(crawlRun.id, runId));

  console.log(
    `\nrun ${runId}: parsed=${parsed} failed=${failures.length} written=${changed} ` +
      `failure-rate=${(failureRate * 100).toFixed(1)}%`,
  );

  if (breakerTripped) {
    console.error('circuit breaker tripped: too many parse failures');
    for (const f of failures.slice(0, 5)) console.error(`  ${f.url}: ${f.reason}`);
    process.exitCode = 1;
  }
});
