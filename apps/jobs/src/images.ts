import { sql } from 'drizzle-orm';
import { imageCache, withDb } from '@tike/db';
import { PoliteFetcher } from '@tike/crawler';
import { crawlConfigSchema } from '@tike/contracts';
import { putObject, r2Client, readR2Config, R2NotConfiguredError } from './r2';
import { normalizeImage, objectKey, packshotScore, PACKSHOT_MIN_WHITE } from './normalize-image';

/**
 * Copy product images into our own storage.
 *
 * Two reasons, and the second is the one that made it urgent. §3 said never to hotlink at
 * scale, because every page view would otherwise put a request on a retailer's server for
 * a picture we could have kept. And Djak serves images only to its own pages, so every Đak
 * card rendered broken until this existed.
 *
 * Runs apart from the crawl rather than inside it. A crawl is bounded by politeness — one
 * request per second to one shop — and images are the same file across re-crawls, so
 * folding them in would have made every nightly run hours longer to re-fetch pictures it
 * already had.
 *
 * Resumable by construction: the cache table records successes and failures alike, and the
 * job only ever asks for URLs it has no record of.
 */

/** How far down a shop's picture list to look before settling for the first. */
const MAX_CANDIDATES = 4;

/**
 * Everything outstanding, unless asked otherwise.
 *
 * A cap made every run stop at 500 and need twenty invocations to get through the
 * catalogue once. The job is resumable and rate-limited per shop, so the honest default
 * is "finish"; `--limit` stays for smoke tests.
 */
const DEFAULT_LIMIT = Number.MAX_SAFE_INTEGER;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : DEFAULT_LIMIT;
  const dryRun = args.includes('--dry-run');
  const shopArg = args.find((a) => a.startsWith('--shop='));
  const shopSlug = shopArg ? shopArg.split('=')[1] : null;

  let config;
  try {
    config = readR2Config();
  } catch (err) {
    if (err instanceof R2NotConfiguredError && dryRun) {
      console.log(`${err.message}\n(continuing: --dry-run does not upload)`);
      config = null;
    } else {
      throw err;
    }
  }
  const client = config ? r2Client(config) : null;

  await withDb(async (db) => {
    // Only images tike would actually show, and only those never attempted. A failure is
    // recorded too, so a dead URL is asked for once rather than every night forever.
    const rows = await db.execute(sql`
      select distinct on (o.image_url) o.image_url as "sourceUrl", s.slug as "shopSlug",
             o.image_urls as "candidates"
      from offer o
      join shop s on s.id = o.shop_id
      where o.in_stock and s.active and o.image_url is not null
        and not exists (select 1 from image_cache c where c.source_url = o.image_url)
        ${shopSlug ? sql`and s.slug = ${shopSlug}` : sql``}
      limit ${limit}
    `);
    const pending = rows.rows as {
      sourceUrl: string;
      shopSlug: string;
      candidates: string[] | null;
    }[];

    const total = await db.execute(sql`
      select count(*)::int as "done" from image_cache where error is null
    `);
    console.log(
      `${pending.length} images to fetch (${(total.rows[0] as { done: number }).done} already stored)` +
        `${dryRun ? ' — dry run' : ''}`,
    );

    // One fetcher per shop, built from that shop's own row, so images inherit the crawl's
    // politeness rather than inventing their own: robots, spacing, retries, and the
    // transport. Djak needs the last of those — its CDN answered some image requests from
    // Node with a 403 and every one from curl with a 200.
    const shopRows = await db.execute(sql`
      select slug, base_url as "baseUrl", min_delay_ms as "minDelayMs", crawl_config as "crawlConfig"
      from shop where active
    `);
    const fetchers = new Map<string, PoliteFetcher>();
    for (const s of shopRows.rows as {
      slug: string;
      baseUrl: string;
      minDelayMs: number;
      crawlConfig: unknown;
    }[]) {
      const config = crawlConfigSchema.parse(s.crawlConfig ?? {});
      const fetcher = new PoliteFetcher(s.baseUrl, s.minDelayMs, config.transport);
      await fetcher.init();
      fetchers.set(s.slug, fetcher);
    }

    let stored = 0;
    let failed = 0;
    let scenesSkipped = 0;

    /*
     * Shops run concurrently, each still one request at a time.
     *
     * The spacing that matters is per domain, and every shop has its own fetcher holding
     * its own queue — so waiting for Sport Vision's 4,391 images before starting Djak's
     * buys nobody anything. Sequentially this is 192 minutes; in parallel it is however
     * long the largest shop takes, about 88.
     */
    const byShop = new Map<string, typeof pending>();
    for (const row of pending) {
      const list = byShop.get(row.shopSlug) ?? [];
      list.push(row);
      byShop.set(row.shopSlug, list);
    }

    const runShop = async (rows: typeof pending) => {
      for (const row of rows) {
        let key = objectKey(row.shopSlug, row.sourceUrl);
        try {
          const fetcher = fetchers.get(row.shopSlug);
          if (!fetcher) throw new Error(`no fetcher for shop ${row.shopSlug}`);
          /*
           * The shop's first picture is not reliably the product.
           *
           * Shops interleave editorial photographs with packshots and the JSON-LD order
           * is simply the order they were uploaded, so 28 of 10.248 stored images were a
           * model lacing a boot or a shoe in coloured smoke rather than the shoe on white.
           *
           * Candidates are tried in the shop's own order and the first that looks like a
           * packshot wins, so in the ordinary case — which is 99.7% of them — this costs
           * exactly one request, the same as before. Only a listing whose first image
           * fails reaches for the next.
           */
          const candidates = row.candidates?.length ? row.candidates : [row.sourceUrl];
          let output: Awaited<ReturnType<typeof normalizeImage>> | null = null;
          let chosen = row.sourceUrl;
          for (const candidate of candidates.slice(0, MAX_CANDIDATES)) {
            const input = Buffer.from(await fetcher.getBinary(candidate));
            const rendition = await normalizeImage(input);
            // Keep the first attempt regardless, so a shop whose every photograph is a
            // scene still gets a picture rather than none.
            output ??= rendition;
            if ((await packshotScore(rendition.data)) >= PACKSHOT_MIN_WHITE) {
              output = rendition;
              chosen = candidate;
              break;
            }
            scenesSkipped += 1;
          }
          if (!output) throw new Error('no usable image');

          if (dryRun || !client || !config) {
            console.log(
              `  would store ${key} (${Math.round(output.bytes / 1024)}kB, ` +
                `${output.width}x${output.height})`,
            );
            stored += 1;
            continue;
          }

          key = objectKey(row.shopSlug, chosen);
          await putObject(client, config, key, output.data, 'image/webp');

          /*
           * Point the offers at the picture that was actually stored.
           *
           * The cache is keyed by source URL and the site looks its image up by the URL
           * on the offer, so promoting a different candidate without moving the offer
           * leaves the site asking for a picture nothing cached — and falling back to
           * hotlinking the very scene photograph this rejected.
           */
          if (chosen !== row.sourceUrl) {
            await db.execute(sql`
              update offer set image_url = ${chosen} where image_url = ${row.sourceUrl}
            `);
          }
          await db
            .insert(imageCache)
            .values({
              // Keyed on the picture actually stored, so a later run does not re-fetch
              // the scene photograph it already rejected.
              sourceUrl: chosen,
              key,
              width: output.width,
              height: output.height,
              bytes: output.bytes,
            })
            .onConflictDoNothing();
          stored += 1;
        } catch (err) {
          failed += 1;
          const reason = err instanceof Error ? err.message.slice(0, 200) : 'unknown';
          console.warn(`  failed ${row.sourceUrl.slice(-60)} — ${reason}`);
          if (!dryRun) {
            // Recorded so the next run does not queue it again. A shop that fixes the
            // image is picked up when its URL changes, which is what a new picture is.
            await db
              .insert(imageCache)
              .values({ sourceUrl: row.sourceUrl, key, error: reason })
              .onConflictDoNothing();
          }
        }
      }
    };

    await Promise.all([...byShop.values()].map(runShop));

    console.log(`\nstored=${stored} failed=${failed} scenes-rejected=${scenesSkipped}`);
  });
}

await main();
