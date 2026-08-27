import { z } from 'zod';

/**
 * Shared contracts. One source of truth for shapes that cross a boundary:
 * crawler -> jobs -> db, and db -> web.
 */

export const genderSchema = z.enum(['men', 'women', 'unisex', 'kids']);
export type Gender = z.infer<typeof genderSchema>;

export const platformSchema = z.enum(['nbshop', 'magento2', 'woo', 'shopify', 'feed']);
export type Platform = z.infer<typeof platformSchema>;

/** One size row as scraped from a product page, before normalization. */
export const rawSizeSchema = z.object({
  raw: z.string().min(1),
  inStock: z.boolean(),
});
export type RawSize = z.infer<typeof rawSizeSchema>;

/**
 * The adapter output contract: what every platform adapter must produce from a
 * product page, regardless of shop. Deliberately shop-agnostic — anything
 * shop-specific belongs in the adapter, not here.
 *
 * NOTE: this shape is a confirmation checkpoint. Every adapter inherits it, so it
 * gets reviewed before adapters are written against it.
 */
export const parsedOfferSchema = z.object({
  url: z.url(),
  externalId: z.string().min(1),
  title: z.string().min(1),
  brand: z.string().min(1).nullable(),
  sku: z.string().nullable(),
  imageUrl: z.url().nullable(),
  priceRaw: z.string().min(1),
  originalPriceRaw: z.string().nullable(),
  currency: z.enum(['BAM', 'EUR']).default('BAM'),
  gender: genderSchema.nullable(),
  /** Empty array is a parse failure, never an out-of-stock product. */
  sizes: z.array(rawSizeSchema),
});
export type ParsedOffer = z.infer<typeof parsedOfferSchema>;
