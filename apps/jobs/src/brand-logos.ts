import { sql } from 'drizzle-orm';
import { ForbiddenError, type PoliteFetcher } from '@tike/crawler';
import type { withDb } from '@tike/db';
import { putObject, type r2Client, type R2Config } from './r2';
import { brandLogoKey, normalizeBrandLogo } from './normalize-brand-logo';

type Db = Parameters<Parameters<typeof withDb>[0]>[0];

/** Enough to find the sharp one among a brand's candidates without fetching every copy. */
const MAX_LOGO_CANDIDATES = 4;

interface Candidate {
  brandId: number;
  brandSlug: string;
  url: string;
  shopSlug: string;
  uses: number;
}

/**
 * Vector first, then formats that carry transparency, then the rest.
 *
 * An SVG stays sharp at any size and a PNG sits on the white box without a rectangle of
 * its own; a JPEG usually brings a white background that only looks right by luck.
 */
function formatRank(url: string): number {
  const path = url.split('?')[0]!.toLowerCase();
  if (path.endsWith('.svg')) return 0;
  if (path.endsWith('.png') || path.endsWith('.webp')) return 1;
  return 2;
}

/**
 * Give every brand that has none a logo of its own, from what the shops show.
 *
 * Runs at the end of the image job, so a brand that arrives with a new shop or a new
 * listing gets its logo the same night its first product is crawled: nothing here is a
 * list of brands, only whatever the crawl recorded. Each brand is tried once per
 * candidate: a logo that fails to fetch, or would not show on white, is remembered on the
 * brand and never asked for again, and the next candidate gets its turn.
 *
 * Every request goes through the shop's own fetcher, so logos obey the same robots,
 * spacing and transport as the crawl. A shop this machine cannot reach (Đak from CI) is
 * skipped without rejecting anything, and its logos wait for the run that can.
 */
export async function storeBrandLogos(opts: {
  db: Db;
  fetchers: Map<string, PoliteFetcher>;
  client: ReturnType<typeof r2Client> | null;
  config: R2Config | null;
  shopSlug: string | null;
  dryRun: boolean;
}): Promise<{ stored: number; rejected: number; waiting: number }> {
  const { db, fetchers, client, config, shopSlug, dryRun } = opts;
  const rows = await db.execute(sql`
    select b.id as "brandId", b.slug as "brandSlug", o.brand_logo_url as "url",
           s.slug as "shopSlug", count(*)::int as "uses"
    from brand b
    join product p on p.brand_id = b.id
    join offer o on o.product_id = p.id
    join shop s on s.id = o.shop_id
    where b.logo_key is null
      and o.in_stock and s.active
      and o.brand_logo_url is not null
      and not (o.brand_logo_url = any(b.logo_rejected))
      ${shopSlug ? sql`and s.slug = ${shopSlug}` : sql``}
    group by b.id, b.slug, o.brand_logo_url, s.slug
  `);

  const byBrand = new Map<number, Candidate[]>();
  for (const row of rows.rows as unknown as Candidate[]) {
    const list = byBrand.get(row.brandId) ?? [];
    list.push(row);
    byBrand.set(row.brandId, list);
  }

  let stored = 0;
  let rejected = 0;
  let waiting = 0;

  for (const candidates of byBrand.values()) {
    candidates.sort((a, b) => formatRank(a.url) - formatRank(b.url) || b.uses - a.uses);
    const reachable = candidates.filter((c) => fetchers.has(c.shopSlug));
    if (reachable.length === 0) {
      waiting += 1;
      continue;
    }

    /*
     * The sharpest of the few on offer, not the first that works.
     *
     * The same brand arrives at very different sizes: Đak's slider serves a 120x45 cut of
     * Converse where Sport Vision has the full upload, and the first version of this took
     * whichever it met first and stored three visibly blurry logos. Each brand is
     * evaluated once and then kept, so looking at every candidate costs a handful of
     * requests a brand, one time. An SVG rasterises to the full box and wins on size; near
     * ties keep the earlier candidate, which is the preferred format.
     */
    let best: {
      candidate: Candidate;
      logo: Awaited<ReturnType<typeof normalizeBrandLogo>>;
    } | null = null;
    for (const candidate of reachable.slice(0, MAX_LOGO_CANDIDATES)) {
      try {
        const input = Buffer.from(await fetchers.get(candidate.shopSlug)!.getBinary(candidate.url));
        const logo = await normalizeBrandLogo(input);
        const area = logo.width * logo.height;
        if (!best || area > best.logo.width * best.logo.height * 1.1) best = { candidate, logo };
      } catch (err) {
        // A shop refusing us is not a verdict on the logo; leave it for another night.
        if (err instanceof ForbiddenError) continue;
        rejected += 1;
        const reason = err instanceof Error ? err.message.slice(0, 120) : 'unknown';
        console.warn(`  ${candidate.brandSlug}: rejected ${candidate.url.slice(-60)} — ${reason}`);
        if (!dryRun) {
          await db.execute(sql`
            update brand set logo_rejected = array_append(logo_rejected, ${candidate.url})
            where id = ${candidate.brandId}
          `);
        }
      }
    }
    if (!best) continue;

    const { candidate, logo } = best;
    const key = brandLogoKey(candidate.brandSlug, candidate.url);
    if (dryRun || !client || !config) {
      console.log(`  would store ${key} (${logo.width}x${logo.height}) from ${candidate.shopSlug}`);
    } else {
      await putObject(client, config, key, logo.data, 'image/webp');
      await db.execute(sql`
        update brand set logo_key = ${key}, logo_source_url = ${candidate.url}
        where id = ${candidate.brandId} and logo_key is null
      `);
      console.log(
        `  ${candidate.brandSlug}: logo from ${candidate.shopSlug} (${logo.width}x${logo.height})`,
      );
    }
    stored += 1;
  }

  return { stored, rejected, waiting };
}
