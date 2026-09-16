import { neon } from '@neondatabase/serverless';

/**
 * What to test against, asked of the catalogue rather than written down.
 *
 * Every shoe in this database arrived from a shop's website and leaves again the moment
 * that shop sells out, so a test naming one would rot within days and start failing for a
 * reason that has nothing to do with the code. These helpers pick a case that exists
 * right now; the tests assert properties that must hold for whichever case that is.
 *
 * Read with the same HTTP driver the site uses (ADR-0001). Single statements only, so the
 * driver's lack of transactions costs nothing here.
 */

/** The size picker hides sizes below this by default, so an adult size is the honest pick. */
export const ADULT_MIN_SIZE = 36;

/**
 * Candidates for "a size nothing stocks".
 *
 * Quarter sizes, because every whole and half size in the adult range is stocked by
 * somebody and a number outside 15-52 is discarded by `parseSizes` before it reaches the
 * query — which shows the whole catalogue rather than an empty result, deliberately, so
 * a hand-edited URL cannot look like a bug.
 */
const ABSENT_CANDIDATES = [44.25, 41.25, 38.25, 47.75];

/** Cards render this many size chips before collapsing the rest into "+N". */
export const CHIPS_PER_CARD = 10;

function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set - see e2e/support/env.ts');
  return neon(url);
}

export interface SizeCase {
  /** A size a lot of shops stock, so the grid has several pages of it. */
  size: number;
  /** A size nothing in the catalogue has, for the empty state. */
  missing: number;
}

export interface ProductCase {
  slug: string;
  shopCount: number;
  /** Cheapest first, in minor units. */
  prices: number[];
  /** Whether the shops disagree on price - the "najjeftinije" badge needs one that does. */
  hasSpread: boolean;
}

export interface OfferCase {
  offerId: number;
  /** Host of the shop's own product URL, which the outclick must land on. */
  host: string;
  shopId: number;
  sizes: number[];
}

let cache: {
  sizes?: Promise<SizeCase>;
  product?: Promise<ProductCase | null>;
  offers: Record<number, Promise<OfferCase | null> | undefined>;
  alias?: Promise<{ from: string; to: string } | null>;
  term?: Promise<string>;
  clipped?: Promise<ClippedCase | null>;
} = { offers: {} };

/** Only useful to a test that deliberately wants a second look at the catalogue. */
export function resetCatalogueCache(): void {
  cache = { offers: {} };
}

export function sizeCase(): Promise<SizeCase> {
  cache.sizes ??= (async () => {
    const db = sql();
    const best = (await db`
      select f.size_eu::float8 as size, count(*)::int as offers
      from offer_size f
      join offer o on o.id = f.offer_id
      join shop s on s.id = o.shop_id
      where f.in_stock and o.in_stock and s.active and f.size_eu >= ${ADULT_MIN_SIZE}
      group by 1
      order by 2 desc, 1
      limit 1
    `) as { size: number; offers: number }[];

    const absent = (await db`
      select c.size::float8 as size,
             (select count(*)::int from offer_size f where f.size_eu = c.size) as stocked
      from unnest(${ABSENT_CANDIDATES}::numeric[]) as c(size)
      order by 2, 1
      limit 1
    `) as { size: number; stocked: number }[];

    const row = best[0];
    if (!row) throw new Error('the catalogue has no in-stock adult sizes at all');
    const gap = absent[0];
    if (!gap || gap.stocked > 0) {
      throw new Error('every candidate size is stocked - pick another in ABSENT_CANDIDATES');
    }
    return { size: row.size, missing: gap.size };
  })();
  return cache.sizes;
}

/** A product several shops carry at different prices - what the comparison exists for. */
export function productCase(): Promise<ProductCase | null> {
  cache.product ??= (async () => {
    const db = sql();
    const rows = (await db`
      select p.slug,
             count(distinct o.shop_id)::int as "shopCount",
             min(o.price_minor)::int as "minPrice",
             max(o.price_minor)::int as "maxPrice"
      from product p
      join offer o on o.product_id = p.id
      join shop s on s.id = o.shop_id
      where o.in_stock and s.active
      group by p.slug
      having count(distinct o.shop_id) > 1 and max(o.price_minor) > min(o.price_minor)
      -- Most shops first, then by slug: a stable choice, so a failure is reproducible
      -- rather than "whichever row Postgres handed back that time".
      order by 2 desc, 1
      limit 1
    `) as { slug: string; shopCount: number; minPrice: number; maxPrice: number }[];

    const row = rows[0];
    if (!row) return null;

    const prices = (await db`
      select o.price_minor::int as price
      from product p
      join offer o on o.product_id = p.id
      join shop s on s.id = o.shop_id
      where p.slug = ${row.slug} and o.in_stock and s.active
      order by o.price_minor asc
    `) as { price: number }[];

    return {
      slug: row.slug,
      shopCount: row.shopCount,
      prices: prices.map((p) => p.price),
      hasSpread: row.maxPrice > row.minPrice,
    };
  })();
  return cache.product;
}

/**
 * One live offer, with the shop URL the outclick is supposed to reach.
 *
 * Takes an index because the click assertion is "this redirect wrote exactly one row",
 * and two projects hitting the same offer at once each see the other's row. A different
 * offer per project keeps the strict count instead of weakening it to "at least one".
 */
export function offerCase(index = 0): Promise<OfferCase | null> {
  cache.offers[index] ??= (async () => {
    const db = sql();
    const rows = (await db`
      select o.id::int as "offerId", o.url, o.shop_id::int as "shopId"
      from offer o
      join shop s on s.id = o.shop_id
      where o.in_stock and s.active and o.url like 'http%'
      order by o.id
      offset ${index}
      limit 1
    `) as { offerId: number; url: string; shopId: number }[];

    const row = rows[0];
    if (!row) return null;

    const sizes = (await db`
      select f.size_eu::float8 as size
      from offer_size f
      where f.offer_id = ${row.offerId} and f.in_stock
      order by 1
    `) as { size: number }[];

    return {
      offerId: row.offerId,
      host: new URL(row.url).host,
      shopId: row.shopId,
      sizes: sizes.map((s) => s.size),
    };
  })();
  return cache.offers[index]!;
}

/** Clicks recorded against offer ids that do not exist - there must never be any. */
export async function clickCountFor(offerIds: number[]): Promise<number> {
  const rows = (await sql()`
    select count(*)::int as n from click where offer_id = any(${offerIds}::int[])
  `) as { n: number }[];
  return rows[0]!.n;
}

export interface ClippedCase {
  slug: string;
  /** The `?model=` key the results page filters on, so the card can be found on its own. */
  familyKey: string;
  /** A size this shoe stocks that sits past the tenth chip. */
  size: number;
  /** How many in-stock sizes it has below that one. */
  below: number;
}

/**
 * A shoe wide enough that a filtered size falls past the last chip a card can show.
 *
 * This is the case a "does every card claim my size" test cannot find by itself: picking
 * the commonest size lands on the shoes everybody stocks, and the first page of those is
 * all narrow size runs. It passed on the first run for exactly that reason, with the bug
 * still in the page.
 *
 * Largest size first, because that is where it bites hardest and who it bites: the larger
 * the foot, the longer the size run beneath it, and large sizes are the ones worth a site
 * like this in the first place.
 */
export function clippedCase(): Promise<ClippedCase | null> {
  cache.clipped ??= (async () => {
    const db = sql();
    const rows = (await db`
      with card as (
        select p.slug,
               btrim(
                 regexp_replace(
                   unaccent(lower(coalesce(b.name, '') || ' ' || p.model)),
                   '[^a-z0-9]+', '-', 'g'
                 ),
                 '-'
               ) as "familyKey",
               f.size_eu::float8 as size,
               (
                 select count(distinct g.size_eu)
                 from offer o2
                 join shop s2 on s2.id = o2.shop_id
                 join offer_size g on g.offer_id = o2.id
                 where o2.product_id = p.id and o2.in_stock and s2.active
                   and g.in_stock and g.size_eu < f.size_eu
               )::int as below
        from product p
        left join brand b on b.id = p.brand_id
        join offer o on o.product_id = p.id
        join shop s on s.id = o.shop_id
        join offer_size f on f.offer_id = o.id
        where o.in_stock and s.active and f.in_stock and f.size_eu >= ${ADULT_MIN_SIZE}
      )
      select distinct slug, "familyKey", size, below
      from card
      where below >= ${CHIPS_PER_CARD}
      order by size desc, slug
      limit 1
    `) as ClippedCase[];
    return rows[0] ?? null;
  })();
  return cache.clipped;
}

/** A slug a product has outgrown, which must still resolve. */
export function aliasCase(): Promise<{ from: string; to: string } | null> {
  cache.alias ??= (async () => {
    const db = sql();
    const rows = (await db`
      select a.slug as "from", p.slug as "to"
      from product_slug_alias a
      join product p on p.id = a.product_id
      where p.slug <> a.slug
      order by a.slug
      limit 1
    `) as { from: string; to: string }[];
    return rows[0] ?? null;
  })();
  return cache.alias;
}

/** A search term the catalogue answers - the commonest brand, whatever that is today. */
export function searchTerm(): Promise<string> {
  cache.term ??= (async () => {
    const db = sql();
    const rows = (await db`
      select b.name, count(*)::int as n
      from product p
      join brand b on b.id = p.brand_id
      join offer o on o.product_id = p.id
      join shop s on s.id = o.shop_id
      where o.in_stock and s.active
      group by 1
      order by 2 desc, 1
      limit 1
    `) as { name: string; n: number }[];
    return rows[0]?.name.toLowerCase() ?? 'nike';
  })();
  return cache.term;
}

/** Sizes a card would claim for one product slug, as the page's own query groups them. */
export async function sizesForSlug(slug: string): Promise<number[]> {
  const rows = (await sql()`
    select distinct f.size_eu::float8 as size
    from product p
    join offer o on o.product_id = p.id
    join shop s on s.id = o.shop_id
    join offer_size f on f.offer_id = o.id
    where p.slug = ${slug} and o.in_stock and s.active and f.in_stock
    order by 1
  `) as { size: number }[];
  return rows.map((r) => r.size);
}

/** Highest click id right now, so a test can tell its own click from everyone else's. */
export async function latestClickId(): Promise<number> {
  const rows = (await sql()`select coalesce(max(id), 0)::int as id from click`) as {
    id: number;
  }[];
  return rows[0]!.id;
}

export interface ClickRow {
  id: number;
  offerId: number;
  shopId: number;
  sizeEu: number | null;
}

export async function clicksAfter(afterId: number, offerId: number): Promise<ClickRow[]> {
  const rows = (await sql()`
    select id::int as id, offer_id::int as "offerId", shop_id::int as "shopId",
           size_eu::float8 as "sizeEu"
    from click
    where id > ${afterId} and offer_id = ${offerId}
    order by id
  `) as ClickRow[];
  return rows;
}

/**
 * Remove the clicks a test made.
 *
 * The click log is the one number a retailer would be shown in a CPC conversation, and
 * §13 is explicit that the rows in it so far are all from testing and must never be
 * described as traffic. A suite running on every pull request would quietly pad that
 * figure, so it takes its own rows back out.
 */
export async function deleteClicks(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await sql()`delete from click where id = any(${ids}::int[])`;
}
