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
  currency: string;
  /** In-stock EU sizes for this listing, ascending. */
  sizesEu: number[];
  /** Always 1 today; becomes the number of shops carrying the shoe after matching. */
  shopCount: number;
}

export interface SearchParams {
  /** Hard filter: only listings a shop can sell in this EU size today. */
  sizeEu?: number;
  brand?: string;
  query?: string;
  limit?: number;
  offset?: number;
}

/**
 * Text matching folds diacritics on both sides, so `muske` matches `muške`.
 *
 * `unaccent()` is not indexable without a materialized column, which is fine at this
 * catalogue size (thousands of rows). When it stops being fine, the fix is a stored
 * normalized column with the trigram index that migration 0001 already prepares.
 */
export async function searchOffers(params: SearchParams = {}): Promise<SearchResult[]> {
  const { sizeEu, brand, query, limit = 48, offset = 0 } = params;

  const rows = await db().execute(sql`
    select
      o.id            as "offerId",
      s.slug          as "shopSlug",
      s.name          as "shopName",
      o.title         as "title",
      o.raw_brand     as "brand",
      o.url           as "url",
      o.image_url     as "imageUrl",
      o.price_minor   as "priceMinor",
      o.currency::text as "currency",
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
      ${
        sizeEu === undefined
          ? sql``
          : sql`and exists (
        select 1 from offer_size f
        where f.offer_id = o.id and f.in_stock and f.size_eu = ${sizeEu}
      )`
      }
      ${brand === undefined ? sql`` : sql`and unaccent(lower(o.raw_brand)) = unaccent(lower(${brand}))`}
      ${
        query === undefined || query.trim() === ''
          ? sql``
          : sql`and unaccent(lower(o.title)) like unaccent(lower(${'%' + query.trim() + '%'}))`
      }
    order by o.price_minor asc
    limit ${limit} offset ${offset}
  `);

  return (rows.rows as Record<string, unknown>[]).map((r) => ({
    offerId: Number(r.offerId),
    shopSlug: String(r.shopSlug),
    shopName: String(r.shopName),
    title: String(r.title),
    brand: r.brand === null ? null : String(r.brand),
    url: String(r.url),
    imageUrl: r.imageUrl === null ? null : String(r.imageUrl),
    priceMinor: Number(r.priceMinor),
    currency: String(r.currency),
    sizesEu: Array.isArray(r.sizesEu) ? r.sizesEu.map(Number) : [],
    shopCount: 1,
  }));
}

/** EU sizes that some shop currently has in stock — used to build the size picker. */
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
  params: { sizeEu?: number; query?: string } = {},
): Promise<{ brand: string; count: number }[]> {
  const { sizeEu, query } = params;
  const rows = await db().execute(sql`
    select o.raw_brand as "brand", count(*)::int as "count"
    from offer o
    join shop s on s.id = o.shop_id
    where o.in_stock and s.active and o.raw_brand is not null
      ${
        sizeEu === undefined
          ? sql``
          : sql`and exists (
              select 1 from offer_size f
              where f.offer_id = o.id and f.in_stock and f.size_eu = ${sizeEu}
            )`
      }
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
