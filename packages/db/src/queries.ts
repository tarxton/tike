import { sql } from 'drizzle-orm';
import { db } from './client';

/**
 * Read queries for the site.
 *
 * Everything the UI needs goes through here, so the eventual switch from per-shop
 * offers to canonical products touches this file and nothing else. Today a "result"
 * is one shop's listing; once matching lands it becomes one shoe with several shops
 * attached, and the shape below already carries `shopCount` to absorb that.
 *
 * Uses the HTTP driver (read path, ADR-0001).
 */

export interface SearchResult {
  offerId: number;
  shopSlug: string;
  shopName: string;
  title: string;
  brand: string | null;
  url: string;
  imageUrl: string | null;
  priceMinor: number;
  /** The pre-sale price when the shop is discounting, otherwise null. */
  originalPriceMinor: number | null;
  /** Whole-percent saving, e.g. 30 for -30%. Null when not on sale. */
  discountPercent: number | null;
  currency: string;
  /** In-stock EU sizes for this listing, ascending. */
  sizesEu: number[];
  /** Always 1 today; becomes the number of shops carrying the shoe after matching. */
  shopCount: number;
}

/**
 * One page of results plus the size of the whole matching set.
 *
 * `total` is not `items.length`: the query is limited, so the two differ as soon as
 * there are more matches than fit on a page. Reporting `items.length` as the result
 * count told the user "48 rezultata" while the brand facet beside it said "Nike 73".
 */
export interface SearchPage {
  items: SearchResult[];
  /** Matching offers across every page, ignoring limit/offset. */
  total: number;
}

export interface SearchParams {
  /**
   * Hard filter: only listings a shop can sell today in at least one of these EU sizes.
   *
   * Multiple sizes are the common case, not an edge case — plenty of people fit both
   * 45 and 46 and want to see either.
   */
  sizesEu?: number[];
  brand?: string;
  query?: string;
  /**
   * Include listings that only come in children's sizes.
   *
   * Off by default. Results are ordered by price, and children's shoes are structurally
   * cheaper, so including them turns an unfiltered search into a wall of kids' shoes
   * before an adult sees a single relevant result.
   */
  includeKids?: boolean;
  limit?: number;
  offset?: number;
}

/** Sizes below this are children's; mirrors ADULT_MIN_SIZE in the web app. */
const ADULT_MIN_SIZE = 36;

/** Excludes listings whose entire in-stock range is children's sizes. */
function kidsFilter(includeKids: boolean | undefined) {
  if (includeKids) return sql``;
  return sql`and exists (
    select 1 from offer_size k
    where k.offer_id = o.id and k.in_stock and k.size_eu >= ${ADULT_MIN_SIZE}
  )`;
}

/** `size_eu in (45, 46)`, or nothing when no sizes are selected. */
function sizeFilter(sizesEu: number[] | undefined) {
  if (!sizesEu || sizesEu.length === 0) return sql``;
  const list = sql.join(
    sizesEu.map((s) => sql`${s}`),
    sql`, `,
  );
  return sql`and exists (
    select 1 from offer_size f
    where f.offer_id = o.id and f.in_stock and f.size_eu in (${list})
  )`;
}

/**
 * Text matching folds diacritics on both sides, so `muske` matches `muške`.
 *
 * `unaccent()` is not indexable without a materialized column, which is fine at this
 * catalogue size (thousands of rows). When it stops being fine, the fix is a stored
 * normalized column with the trigram index that migration 0001 already prepares.
 */
export async function searchOffers(params: SearchParams = {}): Promise<SearchPage> {
  const { sizesEu, brand, query, includeKids, limit = 48, offset = 0 } = params;
  // An explicitly chosen children's size is a deliberate request for them.
  const wantsKids = includeKids || (sizesEu ?? []).some((s) => s < ADULT_MIN_SIZE);

  const rows = await db().execute(sql`
    select
      o.id            as "offerId",
      s.slug          as "shopSlug",
      s.name          as "shopName",
      o.title         as "title",
      o.raw_brand     as "brand",
      o.url           as "url",
      o.image_url     as "imageUrl",
      o.price_minor          as "priceMinor",
      o.original_price_minor as "originalPriceMinor",
      o.currency::text as "currency",
      -- Total across every page, in the same round trip. A separate count query would
      -- double the latency and could disagree with the page under concurrent writes.
      count(*) over() as "totalCount",
      -- json_agg, not array_agg: the HTTP driver hands back Postgres arrays as the
      -- raw string "{40.00,41.00}", whereas JSON arrives as a real array.
      coalesce(
        (
          select json_agg(f.size_eu order by f.size_eu)
          from offer_size f
          where f.offer_id = o.id and f.in_stock
        ),
        '[]'::json
      ) as "sizesEu"
    from offer o
    join shop s on s.id = o.shop_id
    where s.active
      and o.in_stock
      ${sizeFilter(sizesEu)}
      ${kidsFilter(wantsKids)}
      ${brand === undefined ? sql`` : sql`and unaccent(lower(o.raw_brand)) = unaccent(lower(${brand}))`}
      ${
        query === undefined || query.trim() === ''
          ? sql``
          : sql`and unaccent(lower(o.title)) like unaccent(lower(${'%' + query.trim() + '%'}))`
      }
    order by o.price_minor asc
    limit ${limit} offset ${offset}
  `);

  const raw = rows.rows as Record<string, unknown>[];
  const items = raw.map((r) => {
    const priceMinor = Number(r.priceMinor);
    const originalPriceMinor = r.originalPriceMinor === null ? null : Number(r.originalPriceMinor);
    // Only treat it as a sale when the old price is genuinely higher; shops sometimes
    // repeat the current price in the "old price" field.
    const onSale = originalPriceMinor !== null && originalPriceMinor > priceMinor;
    return {
      offerId: Number(r.offerId),
      shopSlug: String(r.shopSlug),
      shopName: String(r.shopName),
      title: String(r.title),
      brand: r.brand === null ? null : String(r.brand),
      url: String(r.url),
      imageUrl: r.imageUrl === null ? null : String(r.imageUrl),
      priceMinor,
      originalPriceMinor: onSale ? originalPriceMinor : null,
      discountPercent: onSale
        ? Math.round(((originalPriceMinor - priceMinor) / originalPriceMinor) * 100)
        : null,
      currency: String(r.currency),
      sizesEu: Array.isArray(r.sizesEu) ? r.sizesEu.map(Number) : [],
      shopCount: 1,
    };
  });

  // No rows means no window to count over, so the total is genuinely zero.
  return { items, total: raw.length === 0 ? 0 : Number(raw[0].totalCount) };
}

/**
 * EU sizes that some shop currently has in stock — used to build the size picker,
 * so a user is never offered a number that returns nothing.
 */
export async function availableSizes(): Promise<number[]> {
  const rows = await db().execute(sql`
    select distinct sz.size_eu as "sizeEu"
    from offer_size sz
    join offer o on o.id = sz.offer_id
    join shop s on s.id = o.shop_id
    where sz.in_stock and s.active
    order by sz.size_eu
  `);
  return (rows.rows as Record<string, unknown>[]).map((r) => Number(r.sizeEu));
}

/**
 * Brands in the in-stock catalogue, most listings first.
 *
 * Counts respect the active size filter: with EU 44 selected, "Nike 14" must mean
 * fourteen Nikes available in 44, not fourteen Nikes in the catalogue. A facet count
 * that ignores the current filter promises results the click cannot deliver.
 */
export async function availableBrands(
  params: { sizesEu?: number[]; query?: string; includeKids?: boolean } = {},
): Promise<{ brand: string; count: number }[]> {
  const { sizesEu, query, includeKids } = params;
  const wantsKids = includeKids || (sizesEu ?? []).some((s) => s < ADULT_MIN_SIZE);
  const rows = await db().execute(sql`
    select o.raw_brand as "brand", count(*)::int as "count"
    from offer o
    join shop s on s.id = o.shop_id
    where o.in_stock and s.active and o.raw_brand is not null
      ${sizeFilter(sizesEu)}
      ${kidsFilter(wantsKids)}
      ${
        query === undefined || query.trim() === ''
          ? sql``
          : sql`and unaccent(lower(o.title)) like unaccent(lower(${'%' + query.trim() + '%'}))`
      }
    group by o.raw_brand
    order by count(*) desc, o.raw_brand asc
  `);
  return (rows.rows as Record<string, unknown>[]).map((r) => ({
    brand: String(r.brand),
    count: Number(r.count),
  }));
}
