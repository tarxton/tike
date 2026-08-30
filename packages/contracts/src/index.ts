import { z } from 'zod';

/**
 * Shared contracts. One source of truth for shapes that cross a boundary:
 * crawler -> jobs -> db, and db -> web.
 */

export const genderSchema = z.enum(['men', 'women', 'unisex', 'kids']);
export type Gender = z.infer<typeof genderSchema>;

export const platformSchema = z.enum([
  'nbshop',
  'magento2',
  'woo',
  'shopify',
  'officeshoes',
  'feed',
]);
export type Platform = z.infer<typeof platformSchema>;

/**
 * Per-shop crawl settings, stored in `shop.crawl_config`.
 *
 * Shops publish their entire catalogue in one sitemap — Buzz lists 4,397 URLs of which
 * only 1,618 are footwear. Filtering by URL path before fetching keeps the crawl inside
 * the catalogue tike covers, and avoids requesting thousands of pages we would discard.
 */
export const crawlConfigSchema = z.object({
  /** First path segment must be one of these, e.g. ["patike"]. Empty means no filter. */
  pathAllow: z.array(z.string().min(1)).default([]),
  /**
   * Path must contain one of these anywhere, e.g. ["patike"].
   *
   * For shops that do not put the category in its own path segment. NBSHOP gives
   * `/patike/123-nike-air`, which `pathAllow` handles; Office Shoes bakes the type into
   * the product slug — `/cipele-guess-plitke-patike-cribe/75024` — where the first
   * segment is unique per product and matches nothing.
   */
  pathContains: z.array(z.string().min(1)).default([]),
  /**
   * How product URLs are found.
   *
   * A sitemap is the polite default and the only thing NBSHOP needs. Office Shoes
   * publishes none — unknown paths return the homepage with a 200 rather than a 404 —
   * so its categories have to be walked page by page instead.
   */
  discovery: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('sitemap') }),
      z.object({
        kind: z.literal('paginated'),
        /** Category listing paths, each walked until it stops returning products. */
        categories: z.array(z.string().min(1)).min(1),
        /** Products per page, as the listing URL itself declares. */
        pageSize: z.number().int().positive().default(48),
        /** Refuses to walk forever if a shop keeps answering 200 with content. */
        maxPages: z.number().int().positive().default(40),
      }),
    ])
    .default({ kind: 'sitemap' }),
});
export type CrawlConfig = z.infer<typeof crawlConfigSchema>;

/**
 * One size row as scraped from a product page, before normalization.
 *
 * `euRaw` is the shop's own EU label ("41", "40 2/3"); normalization to a canonical
 * number happens in @tike/core, not here — adapters extract, they do not interpret.
 *
 * `gtin` is present when the shop exposes a per-size barcode. NBSHOP does, in
 * `data-combination-code`, which makes exact cross-shop matching possible without
 * falling back to fuzzy similarity.
 */
export const rawSizeSchema = z.object({
  raw: z.string().min(1),
  euRaw: z.string().nullable(),
  usRaw: z.string().nullable(),
  ukRaw: z.string().nullable(),
  inStock: z.boolean(),
  gtin: z.string().nullable(),
  /** Some shops price per size. Null means "use the offer price". */
  priceRaw: z.string().nullable(),
});
export type RawSize = z.infer<typeof rawSizeSchema>;

/**
 * The adapter output contract: what every platform adapter must produce from a
 * product page, regardless of shop. Deliberately shop-agnostic — anything
 * shop-specific belongs in the adapter, not here.
 *
 * Adapters extract; they never normalize, convert or match. That keeps them small,
 * testable against fixtures, and replaceable when a shop changes its markup.
 */
export const parsedOfferSchema = z.object({
  url: z.url(),
  /** The shop's own product id, unique within that shop. */
  externalId: z.string().min(1),
  title: z.string().min(1),
  brand: z.string().min(1).nullable(),
  /** Manufacturer style code or the shop's SKU field, verbatim. */
  sku: z.string().nullable(),
  imageUrl: z.url().nullable(),
  priceRaw: z.string().min(1),
  originalPriceRaw: z.string().nullable(),
  currency: z.enum(['BAM', 'EUR']).default('BAM'),
  gender: genderSchema.nullable(),
  /**
   * Every size the page lists, in stock or not — the out-of-stock ones are what tell
   * a user "this shop has it, just not in your size".
   *
   * An empty array is a PARSE FAILURE, never an out-of-stock product. Callers must
   * count it toward the crawl's failure budget rather than writing it to the database.
   */
  sizes: z.array(rawSizeSchema),
});
export type ParsedOffer = z.infer<typeof parsedOfferSchema>;
