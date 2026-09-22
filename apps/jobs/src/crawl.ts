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
  UnavailableError,
  FetchError,
  PoliteFetcher,
  XHR_HEADERS,
  filterByPath,
  filterByPathContains,
  isSitemapIndex,
  isSoftNotFound,
  juventaListingUrl,
  juventaProductApiUrl,
  listingPageUrl,
  parseJuventaListing,
  parseListingProducts,
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

/**
 * How much of a catalogue can go unreachable before a run loses the right to retire
 * anything. Deliberately looser than the parse budget: a handful of pages timing out is
 * ordinary, whereas markup that will not parse is never ordinary.
 */
const UNREACHABLE_RETIREMENT_THRESHOLD = 0.1;

/**
 * How many listings missing from discovery a run checks one by one: 5% of what it
 * crawled, and never fewer than 50. Past that, the sitemap is more likely broken than the
 * catalogue emptied, and the staleness rule is the safer judge.
 */
const VERIFY_SHARE = 0.05;
const MIN_VERIFY_CAP = 50;

/**
 * How many consecutive successful runs an offer may go unseen before it is treated as
 * gone. Three rather than one because a single crawl can miss a page for reasons that
 * say nothing about stock — a timeout, a shop's own sitemap hiccup, a transient 500.
 */
const STALE_AFTER_RUNS = 3;

const args = process.argv.slice(2);
const shopSlug = args.find((a) => !a.startsWith('--'));
const limitArg = args.find((a) => a.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : Infinity;
const dryRun = args.includes('--dry-run');

if (!shopSlug) {
  console.error('usage: pnpm crawl <shop-slug> [--limit=N] [--dry-run]');
  process.exit(1);
}

/** The polite path: one request, and the list the shop publishes for crawlers. */
async function discoverFromSitemap(fetcher: PoliteFetcher, sitemapUrl: string): Promise<string[]> {
  const xml = await fetcher.get(sitemapUrl);
  if (!isSitemapIndex(xml)) return parseSitemapLocs(xml);

  const children = parseSitemapLocs(xml);
  const productSitemap = selectProductSitemap(children);
  if (productSitemap) {
    console.log(`sitemap index -> ${productSitemap}`);
    return parseSitemapLocs(await fetcher.get(productSitemap));
  }

  // No sitemap names itself for products, so read them all and let the shop's path
  // filter decide. Magento numbers its children — sitemap-1-1.xml, -1-2, -1-3 — with
  // products spread across more than one, so picking a single "product" file finds
  // nothing and picking the first would silently drop most of the catalogue.
  console.log(`sitemap index -> ${children.length} child sitemaps, reading all`);
  const urls: string[] = [];
  for (const child of children) {
    urls.push(...parseSitemapLocs(await fetcher.get(child)));
  }
  return urls;
}

/**
 * The fallback for shops with no sitemap: walk each category's own pagination.
 *
 * Stops a category as soon as a page yields nothing new. That covers both ends of the
 * catalogue honestly — Office Shoes answers past-the-end requests with its homepage and
 * a 200, so "no products in the response" is the only reliable end marker, and `maxPages`
 * guards against a shop that would keep answering forever.
 */
async function discoverFromCategories(
  fetcher: PoliteFetcher,
  baseUrl: string,
  discovery: { categories: string[]; pageSize: number; maxPages: number },
): Promise<string[]> {
  const found = new Set<string>();

  for (const category of discovery.categories) {
    let pagesWalked = 0;
    for (let page = 0; page < discovery.maxPages; page += 1) {
      const url = listingPageUrl(baseUrl, category, page);
      const html = await fetcher.get(url, XHR_HEADERS);
      if (isSoftNotFound(html)) break;

      const products = parseListingProducts(html, baseUrl);
      const before = found.size;
      for (const p of products) found.add(p);
      pagesWalked += 1;

      // A page of entirely familiar products means the walk has looped or run out.
      if (found.size === before) break;
    }
    console.log(`  ${category}: ${pagesWalked} pages, ${found.size} urls so far`);
  }

  return [...found];
}

/**
 * Juventa's catalogue API: its listing, filtered to the sneaker types, twenty at a time.
 *
 * Yields API URLs rather than storefront ones, because the storefront is an empty shell
 * and the API is what carries the data. The parser turns each back into the page a
 * shopper opens. The walk ends at the shop's own total, or at a page that adds nothing
 * new, which also covers a listing that reshuffles while it is being read.
 */
async function discoverFromJuventaApi(
  fetcher: PoliteFetcher,
  baseUrl: string,
  discovery: { typeIds: string[]; maxPages: number },
  /** `--limit`: stop listing once this many are found, since every page costs the shop ~13s. */
  enough: number,
): Promise<string[]> {
  const ids = new Set<string>();
  let total = 0;
  let pages = 0;
  for (let page = 1; page <= discovery.maxPages; page += 1) {
    const listing = parseJuventaListing(
      await fetcher.get(juventaListingUrl(baseUrl, discovery.typeIds, page)),
      page,
    );
    pages += 1;
    total = listing.total;
    const before = ids.size;
    for (const id of listing.ids) ids.add(id);
    if (listing.last || ids.size === before || ids.size >= enough) break;
  }
  console.log(`  listing: ${pages} pages, ${ids.size} products (shop reports ${total})`);
  return [...ids].map((id) => juventaProductApiUrl(baseUrl, id));
}

/**
 * Mark offers the shop has stopped listing as out of stock.
 *
 * They are never deleted: the URL may still resolve, the price history is worth keeping,
 * and a returning product should come back as the same row rather than a new one. But an
 * offer that has survived three successful crawls without being seen is not something a
 * shopper can buy, and leaving it in stock is a lie the site tells with a straight face.
 *
 * The cutoff is the start of the third-most-recent successful run. Before three runs
 * exist that subquery is NULL and nothing is retired, which is the safe direction: a new
 * shop cannot have its catalogue emptied by its own first crawl.
 */
async function retireUnseenOffers(
  db: Parameters<Parameters<typeof withDb>[0]>[0],
  shopId: number,
): Promise<number> {
  const result = await db.execute(sql`
    update offer o
    set in_stock = false
    where o.shop_id = ${shopId}
      and o.in_stock
      and o.last_seen_at < (
        select r.started_at from crawl_run r
        where r.shop_id = ${shopId} and r.status = 'ok'
        order by r.id desc
        offset ${STALE_AFTER_RUNS - 1} limit 1
      )
  `);
  return result.rowCount ?? 0;
}

await withDb(async (db) => {
  const [row] = await db.select().from(shop).where(eq(shop.slug, shopSlug)).limit(1);
  if (!row) throw new Error(`unknown shop "${shopSlug}" — seed it first`);
  if (!row.active) throw new Error(`shop "${shopSlug}" is inactive; refusing to crawl`);

  const config = crawlConfigSchema.parse(row.crawlConfig ?? {});
  if (config.discovery.kind === 'sitemap' && !row.sitemapUrl) {
    throw new Error(`shop "${shopSlug}" has no sitemap configured`);
  }

  const fetcher = new PoliteFetcher(row.baseUrl, row.minDelayMs, config.transport);
  const { crawlDelayMs, effectiveDelayMs } = await fetcher.init();
  console.log(
    `shop=${row.slug} platform=${row.platform} transport=${config.transport} ` +
      `robots crawl-delay=${crawlDelayMs}ms effective delay=${effectiveDelayMs}ms`,
  );

  const discovered =
    config.discovery.kind === 'sitemap'
      ? await discoverFromSitemap(fetcher, row.sitemapUrl!)
      : config.discovery.kind === 'paginated'
        ? await discoverFromCategories(fetcher, row.baseUrl, config.discovery)
        : await discoverFromJuventaApi(fetcher, row.baseUrl, config.discovery, limit);

  // Shops list their whole catalogue; keep only the categories tike covers. Apparel is
  // out of scope, not a parse failure, so it must be excluded before fetching.
  const inScope = filterByPathContains(
    filterByPath(discovered, config.pathAllow),
    config.pathContains,
  ).filter((url) => !config.pathDeny.some((deny) => url.includes(deny)));
  const urls = inScope.slice(0, Number.isFinite(limit) ? limit : undefined);
  console.log(
    `discovery found ${discovered.length} urls; ${inScope.length} in scope ` +
      `(${[...config.pathAllow, ...config.pathContains].join(', ') || 'no filter'}); ` +
      `crawling ${urls.length}`,
  );

  const [run] = await db
    .insert(crawlRun)
    .values({ shopId: row.id, status: 'running', urlsSeen: urls.length })
    .returning({ id: crawlRun.id });
  const runId = run!.id;

  /*
   * Close out runs a previous process never finished.
   *
   * A run is marked `ok` or `aborted_parse_threshold` at the end, so a crawl killed
   * partway — a 403 that threw, a runner timing out, a machine shut down — leaves its row
   * saying `running` for ever. Seven such rows had accumulated, the oldest sixteen days
   * old, and any per-shop health report would have counted seven crawls still in flight.
   *
   * Reconciled here rather than by a cleanup job: this is the only code that knows a
   * previous run for this shop cannot still be going, because it is the one starting the
   * next one. The concurrency group in the workflow guarantees no overlap per shop.
   */
  const abandoned = await db.execute(sql`
    update crawl_run
    set status = 'failed', finished_at = now()
    where shop_id = ${row.id} and status = 'running' and id <> ${runId}
  `);
  if ((abandoned.rowCount ?? 0) > 0) {
    console.log(`reconciled ${abandoned.rowCount} abandoned run(s) for this shop`);
  }

  const parse = parserFor(row.platform);
  const failures: { url: string; reason: string }[] = [];
  let parsed = 0;
  let changed = 0;
  /** Read fine, nothing to sell. Reported, but kept out of the failure budget. */
  let unavailable = 0;
  /** Pages the shop has taken down: a 404 or 410 for a product it used to list. */
  let gone = 0;
  /** Of those two, how many tike was still showing as in stock. */
  let withdrawnCount = 0;
  /** Never fetched, after retries. Not the shop's markup and not ours. */
  const unreachable: { url: string; reason: string }[] = [];

  /*
   * Which offer a fetched URL belongs to.
   *
   * The URL is the offer's own page everywhere but Juventa, whose data comes from its API;
   * there the offer is found by the product id in the API address instead.
   */
  const offerForUrl = (url: string) => {
    const apiId = row.platform === 'juventa' ? /\/getProduct\/([^/?#]+)/.exec(url)?.[1] : undefined;
    return apiId ? sql`external_id = ${decodeURIComponent(apiId)}` : sql`url = ${url}`;
  };

  /*
   * Take an offer off the site now, not three crawls from now.
   *
   * The staleness rule exists for pages the crawler could not read, where a missed page
   * says nothing about stock. These were read, and the shop itself says the shoe is gone,
   * sold out in every size or the page removed. Waiting out three runs left them on tike
   * as available for days, sending people to a page with nothing to buy. The row is kept,
   * as the rule keeps it, so price history and links survive and a return writes it back.
   */
  const withdraw = async (url: string): Promise<void> => {
    if (dryRun) return;
    const res = await db.execute(sql`
      update offer set in_stock = false, last_seen_at = now()
      where shop_id = ${row.id} and in_stock and ${offerForUrl(url)}
    `);
    withdrawnCount += res.rowCount ?? 0;
  };

  const save = async (normalized: ReturnType<typeof normalizeOffer>): Promise<void> => {
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
          imageUrls: normalized.imageUrls,
          brandLogoUrl: normalized.brandLogoUrl,
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
            /*
             * The picture the image job chose, for as long as the shop still lists it.
             *
             * The job moves an offer off a scene photograph onto the packshot behind it,
             * and every crawl used to move it straight back to the shop's first picture.
             * So each night the job fetched the same rejected photographs again — 29 of
             * them on 2026-09-17 — and until it ran, those cards were hotlinking the very
             * scene it had rejected, which for Đak is a broken image.
             *
             * Kept only when it *was* a choice: the stored picture differs from the first
             * candidate the last crawl proposed. A picture that is simply last night's
             * proposal gives way to tonight's, so a better first picture — an adapter
             * that learns to read the shop's main image, say — still reaches the card
             * instead of being frozen out by the rule meant to protect the job's picks.
             * And a picture the shop no longer lists always gives way.
             */
            imageUrl: sql`case
              when ${offer.imageUrl} is distinct from ${offer.imageUrls}[1]
                and ${offer.imageUrl} = any(excluded.image_urls)
                then ${offer.imageUrl}
              else excluded.image_url
            end`,
            imageUrls: normalized.imageUrls,
            brandLogoUrl: normalized.brandLogoUrl,
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
          // Adapters have always extracted these; the write dropped them, which left
          // matching tier 1 with nothing to compare and silently unreachable.
          gtin: s.gtin,
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
  };

  type Outcome = 'written' | 'unavailable' | 'gone' | 'unreachable' | 'failed';

  /** Fetch, read and store one product page, and say what became of it. */
  const processPage = async (url: string, label: string): Promise<Outcome> => {
    try {
      const html = await fetcher.get(url);
      const normalized = normalizeOffer(parse(html, url));
      parsed += 1;
      if (dryRun) {
        console.log(
          `  ${label} ${normalized.brand} ${normalized.model} — ` +
            `${normalized.sizes.length} sizes, ${normalized.sizes.filter((s) => s.inStock).length} in stock`,
        );
        return 'written';
      }
      await save(normalized);
      changed += 1;
      return 'written';
    } catch (err) {
      if (err instanceof ForbiddenError) throw err; // stop the whole run
      // A product the shop has sold out of is not a failure of any kind. Magento lists
      // its whole history in the sitemap and 70% of Djak's sneakers are gone, so counting
      // these would hold that shop permanently over the breaker while its markup is fine.
      if (err instanceof UnavailableError) {
        unavailable += 1;
        await withdraw(url);
        return 'unavailable';
      }
      // A page the shop has removed answers 404, and that is an answer, not an outage:
      // counted as unreachable it waited out the staleness rule while still listed.
      if (err instanceof FetchError && (err.status === 404 || err.status === 410)) {
        gone += 1;
        await withdraw(url);
        return 'gone';
      }
      // One unreachable page costs that page, not the thousands still unvisited. Counted,
      // because a run that could not fetch much of the catalogue has not seen it, and must
      // not be trusted to decide what the shop no longer sells.
      if (err instanceof FetchError) {
        unreachable.push({ url, reason: err.message.slice(0, 200) });
        console.warn(`  unreachable: ${url} — ${err.message.slice(0, 120)}`);
        return 'unreachable';
      }
      // Only bad *data* counts toward the failure budget. A database or network error
      // is a bug or an outage, not a shop changing its markup, and hiding it in the
      // parse-failure count would let the circuit breaker measure the wrong thing.
      const isDataProblem = err instanceof NormalizationError || err instanceof ParseError;
      if (!isDataProblem) throw err;
      failures.push({ url, reason: err.message.slice(0, 200) });
      console.warn(`  parse failure: ${url} — ${err.message.slice(0, 120)}`);
      return 'failed';
    }
  };

  for (const [i, url] of urls.entries()) {
    if (!fetcher.isAllowed(url)) {
      console.warn(`skipped (robots): ${url}`);
      continue;
    }
    await processPage(url, `[${i + 1}/${urls.length}]`);
  }

  const attempted = parsed + failures.length;
  // Nothing attempted is no longer evidence of trouble: a slice of Djak's catalogue can
  // be entirely sold out, and calling that a 100% failure rate reported a broken shop
  // whose markup parsed perfectly every time.
  const failureRate = attempted === 0 ? 0 : failures.length / attempted;
  const breakerTripped =
    attempted >= MIN_PAGES_FOR_THRESHOLD && failureRate > PARSE_FAILURE_THRESHOLD;
  // A dry or limited run visited a slice at most. Recorded as `ok`, it counted as one of the
  // three full passes the staleness rule waits for, so a single test run quietly cut a
  // shop's grace to two real crawls.
  const partial = dryRun || Number.isFinite(limit);

  await db
    .update(crawlRun)
    .set({
      finishedAt: sql`now()`,
      status: breakerTripped ? 'aborted_parse_threshold' : partial ? 'partial' : 'ok',
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
      `sold-out=${unavailable} gone=${gone} withdrawn=${withdrawnCount} ` +
      `unreachable=${unreachable.length} ` +
      `failure-rate=${(failureRate * 100).toFixed(1)}%`,
  );

  if (breakerTripped) {
    console.error('circuit breaker tripped: too many parse failures');
    for (const f of failures.slice(0, 5)) console.error(`  ${f.url}: ${f.reason}`);
    process.exitCode = 1;
    // A tripped run proves nothing about what the shop still sells, so it must not be
    // allowed to retire anything.
    return;
  }

  // Only a full pass can conclude anything about what a shop no longer sells. A limited
  // or dry run visits a slice of the catalogue at most, so retiring after one would mark
  // everything it did not happen to reach as out of stock — a 40-page smoke test would
  // empty the shop.
  if (partial) {
    console.log('partial run: skipping staleness retirement');
    return;
  }

  // A run that could not reach much of the catalogue has not seen it, and a page unseen
  // for the wrong reason must not be read as a product withdrawn. The same logic as the
  // parse breaker, against a different failure: there, the markup changed; here, the shop
  // was unreachable, and both end with tike concluding a shop stopped selling things it
  // still sells.
  const unreachableRate = urls.length === 0 ? 0 : unreachable.length / urls.length;
  if (unreachableRate > UNREACHABLE_RETIREMENT_THRESHOLD) {
    console.warn(
      `${(unreachableRate * 100).toFixed(1)}% of urls were unreachable: ` +
        `skipping staleness retirement, since this run cannot say what is still sold`,
    );
    for (const u of unreachable.slice(0, 5)) console.warn(`  ${u.url}: ${u.reason}`);
    return;
  }

  /*
   * Listings the shop stopped publishing, checked rather than waited out.
   *
   * A product that drops out of the sitemap is usually gone: Đak's EA7 "Black&White
   * Vintage" left its sitemap on 2026-09-18 and its page answered 404, yet tike kept it as
   * available until three more crawls had missed it, which a failed night stretched to
   * five days. So each listing this run did not reach is asked for directly, once: a page
   * that is gone or sold out comes off now, one that still sells is simply updated, and
   * anything inconclusive is left to the staleness rule as before.
   *
   * Bounded, because a sitemap that suddenly lost half the catalogue is more likely broken
   * than emptied, and re-fetching everything it dropped would be a second crawl in disguise.
   */
  const attemptedUrls = new Set(urls);
  const missing = (
    await db.execute(sql`
      select url, external_id as "externalId"
      from offer
      where shop_id = ${row.id} and in_stock
        and last_seen_at < (select started_at from crawl_run where id = ${runId})
    `)
  ).rows as { url: string; externalId: string }[];
  const toCheck = missing
    .map((o) =>
      row.platform === 'juventa' ? juventaProductApiUrl(row.baseUrl, o.externalId) : o.url,
    )
    .filter((url) => !attemptedUrls.has(url) && fetcher.isAllowed(url));
  const verifyCap = Math.max(MIN_VERIFY_CAP, Math.ceil(urls.length * VERIFY_SHARE));
  if (toCheck.length > verifyCap) {
    console.warn(
      `${toCheck.length} listings missing from discovery, more than ${verifyCap}: ` +
        `not checking them one by one; the staleness rule decides`,
    );
  } else if (toCheck.length > 0) {
    const outcomes = { written: 0, unavailable: 0, gone: 0, unreachable: 0, failed: 0 };
    for (const [i, url] of toCheck.entries()) {
      outcomes[await processPage(url, `[check ${i + 1}/${toCheck.length}]`)] += 1;
    }
    console.log(
      `checked ${toCheck.length} listings missing from discovery: still listed=${outcomes.written} ` +
        `sold-out=${outcomes.unavailable} gone=${outcomes.gone} ` +
        `inconclusive=${outcomes.unreachable + outcomes.failed}`,
    );
  }

  const retired = await retireUnseenOffers(db, row.id);
  if (retired > 0)
    console.log(`retired ${retired} offers unseen by the last ${STALE_AFTER_RUNS} runs`);
});
