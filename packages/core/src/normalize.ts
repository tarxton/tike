import type { ParsedOffer } from '@tike/contracts';
import { parsePrice, type Currency, type Money } from './money';
import { convertSize, parseEuSize, type Gender } from './size';
import { normalizeForSearch, slugify } from './text';

/**
 * Turns raw adapter output into the shapes the database stores.
 *
 * Adapters extract; this normalizes. Keeping the two apart means a shop changing its
 * markup only touches an adapter, and a change to how sizes or money are stored only
 * touches this file.
 */

export interface NormalizedSize {
  sizeRaw: string;
  sizeEu: number;
  sizeUs: number | null;
  sizeUk: number | null;
  inStock: boolean;
  gtin: string | null;
}

export interface NormalizedOffer {
  externalId: string;
  url: string;
  title: string;
  brand: string | null;
  /** Model with the brand and category noise stripped: "Nike Patike NIKE DUNK LOW" -> "DUNK LOW". */
  model: string;
  slug: string;
  sku: string | null;
  imageUrl: string | null;
  price: Money;
  /** Pre-sale price, only set when the shop is genuinely discounting. */
  originalPrice: Money | null;
  gender: Gender | null;
  inStock: boolean;
  searchDoc: string;
  sizes: NormalizedSize[];
}

/** Category words shops put in the title; they carry no product information. */
const CATEGORY_NOISE = /\b(patike|tenisice|obu[cć]a|cipele|sneakers?|shoes)\b/gi;

/**
 * Strip the brand and category words from a shop title.
 * NBSHOP titles repeat the brand ("Nike Patike NIKE DUNK LOW RETRO"), so the brand is
 * removed wherever it appears, not only at the start.
 */
export function cleanModel(title: string, brand: string | null): string {
  let out = title;
  if (brand) {
    out = out.replace(new RegExp(`\\b${escapeRegExp(brand)}\\b`, 'gi'), ' ');
  }
  out = out.replace(CATEGORY_NOISE, ' ');
  return out.replace(/\s+/g, ' ').trim();
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** "10.5" -> 10.5, "11C" -> null. Kids' US labels are not numeric sizes. */
function numericOrNull(raw: string | null): number | null {
  if (!raw) return null;
  const match = raw
    .trim()
    .replace(',', '.')
    .match(/^(\d{1,2}(?:\.\d)?)$/);
  return match?.[1] ? Number(match[1]) : null;
}

export class NormalizationError extends Error {}

/**
 * Normalize one parsed offer.
 *
 * Throws when the offer cannot be stored meaningfully — no price, or no size survived
 * parsing. Callers count those as parse failures rather than writing partial rows: an
 * offer with no sizes is indistinguishable from "sold out in every size", which is a
 * lie the whole product is built to avoid telling.
 */
export function normalizeOffer(parsed: ParsedOffer): NormalizedOffer {
  const price = parsePrice(parsed.priceRaw, parsed.currency as Currency);
  if (!price) throw new NormalizationError(`unparseable price "${parsed.priceRaw}"`);

  // A discount is only a discount if the old price is higher. Shops routinely repeat
  // the current price in the old-price field on full-price products.
  const originalParsed = parsed.originalPriceRaw
    ? parsePrice(parsed.originalPriceRaw, parsed.currency as Currency)
    : null;
  const originalPrice =
    originalParsed && originalParsed.amountMinor > price.amountMinor ? originalParsed : null;

  const sizes: NormalizedSize[] = [];
  for (const raw of parsed.sizes) {
    const eu = raw.euRaw ? parseEuSize(raw.euRaw) : null;
    if (!eu) continue; // a size we cannot place on the EU scale is not filterable
    const converted = convertSize(eu.sizeEu, {
      brand: parsed.brand ?? undefined,
      gender: parsed.gender ?? undefined,
    });
    sizes.push({
      sizeRaw: raw.raw,
      sizeEu: eu.sizeEu,
      // Prefer the shop's own numbers; fall back to conversion only when absent.
      sizeUs: numericOrNull(raw.usRaw) ?? converted.us,
      sizeUk: numericOrNull(raw.ukRaw) ?? converted.uk,
      inStock: raw.inStock,
      gtin: raw.gtin,
    });
  }

  if (sizes.length === 0) {
    throw new NormalizationError('no parseable sizes');
  }

  const merged = mergeDuplicateEuSizes(sizes);

  const model = cleanModel(parsed.title, parsed.brand);
  const searchDoc = normalizeForSearch([parsed.brand, model, parsed.sku].filter(Boolean).join(' '));

  return {
    externalId: parsed.externalId,
    url: parsed.url,
    title: parsed.title,
    brand: parsed.brand,
    model,
    slug: slugify([parsed.brand, model].filter(Boolean).join(' ')),
    sku: parsed.sku,
    imageUrl: parsed.imageUrl,
    price,
    originalPrice,
    gender: parsed.gender,
    inStock: merged.some((s) => s.inStock),
    searchDoc,
    sizes: merged,
  };
}

/**
 * Collapse rows that share an EU size.
 *
 * Some brands map two US sizes onto one EU size — Converse lists US 3.5 and US 4 both
 * as EU 36. Users filter by EU size, so the question is "can this shop sell me EU 36?",
 * which is true if *either* variant is in stock. Availability is therefore OR-ed, and
 * an in-stock variant wins the row so its barcode and label are the ones kept.
 */
function mergeDuplicateEuSizes(sizes: NormalizedSize[]): NormalizedSize[] {
  const byEu = new Map<number, NormalizedSize>();
  for (const size of sizes) {
    const existing = byEu.get(size.sizeEu);
    if (!existing) {
      byEu.set(size.sizeEu, size);
      continue;
    }
    const preferred = existing.inStock ? existing : size.inStock ? size : existing;
    byEu.set(size.sizeEu, { ...preferred, inStock: existing.inStock || size.inStock });
  }
  return [...byEu.values()];
}
