import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import { parsedOfferSchema, type Gender, type ParsedOffer, type RawSize } from '@tike/contracts';
import { ParseError, UnavailableError } from '../errors';

/**
 * Magento 2 adapter.
 *
 * Written against djaksport.ba, whose operator gave written permission to crawl at one
 * request per second. Magento 2 is one of the most widely deployed store platforms in the
 * region, so this adapter is per-platform like the others: the next Magento shop should
 * be a config row.
 *
 * There is no JSON-LD here. Identity, price and sizes all come out of the JSON blob that
 * Magento hands its swatch renderer:
 *
 *   <script type="text/x-magento-init">
 *     { "[data-role=swatch-options]": { "Magento_Swatches/js/swatch-renderer": {
 *         "jsonConfig": { attributes, optionPrices, prices, productId } } } }
 *
 * Three things about this platform the parser has to respect:
 *
 * 1. **Only salable options appear.** Magento drops sold-out sizes from `attributes`
 *    rather than marking them, so every size read here is in stock — the same shape as
 *    Office Shoes, and tike cannot say "they have it, not in your size" for this shop.
 *
 * 2. **A sold-out product empties the whole config**: no attributes, no option prices,
 *    and `prices` zeroed. That is most of the catalogue, not an edge case, which is why
 *    it raises `UnavailableError` rather than counting as a parse failure.
 *
 * 3. **The DOM's prices cannot be trusted.** `data-price-amount` appears on the related
 *    products carousel too, and on one sampled page the second and third values belonged
 *    to a different shoe entirely. Prices are read from `jsonConfig` only.
 */

interface OptionPrice {
  amount?: number;
}

interface SwatchOption {
  label?: string;
  products?: string[];
}

interface SwatchAttribute {
  code?: string;
  label?: string;
  options?: SwatchOption[];
}

interface JsonConfig {
  productId?: string | number;
  attributes?: Record<string, SwatchAttribute> | SwatchAttribute[];
  prices?: Record<string, OptionPrice>;
}

/**
 * The swatch renderer's config, or null when the page carries none.
 *
 * A Magento page holds dozens of `x-magento-init` blocks; only one of them configures
 * the swatch renderer, and the rest are navigation, cart and analytics widgets.
 */
function findSwatchConfig($: CheerioAPI): JsonConfig | null {
  for (const el of $('script[type="text/x-magento-init"]').toArray()) {
    const raw = $(el).contents().text();
    if (!raw.includes('jsonConfig')) continue;
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      continue;
    }
    const blocks = data as Record<string, Record<string, { jsonConfig?: JsonConfig }>>;
    for (const modules of Object.values(blocks ?? {})) {
      for (const config of Object.values(modules ?? {})) {
        if (config?.jsonConfig) return config.jsonConfig;
      }
    }
  }
  return null;
}

/** `attributes` is an object when Magento has options and an empty array when it does not. */
function attributeList(attributes: JsonConfig['attributes']): SwatchAttribute[] {
  if (!attributes) return [];
  return Array.isArray(attributes) ? attributes : Object.values(attributes);
}

/**
 * The brand, taken as everything before the word "PATIKE" in the title.
 *
 * Djak titles are built as "<BRAND> PATIKE <MODEL> <AUDIENCE>": "NIKE PATIKE AIR PRESTO
 * ZA MUŠKARCE", "PUMA PATIKE PUMA KARMEN II JR DJEVOJČICE". Taking the first word alone
 * would truncate "NEW BALANCE", and the URL slug cannot be used instead because it is
 * not consistently brand-first — one sampled product is `muske-patike-nike-air-presto-…`,
 * with the audience ahead of the brand.
 */
function extractBrand(title: string): string | null {
  const match = title.match(/^(.*?)\s+PATIKE\b/i);
  const brand = match?.[1]?.trim();
  return brand ? brand : null;
}

/**
 * Who the shoe is for, from the audience phrase Djak puts in every title.
 *
 * Unusually good for this project: NBSHOP had to be read out of prose because its titles
 * say nothing, whereas these state it outright. Children are checked first, because
 * mislabelling a child's shoe is the expensive error — it is what puts a toddler size in
 * front of someone filtering 44.
 */
function extractGender(title: string): Gender | null {
  const t = title.toLowerCase();
  // Both spellings of every one of these words. Đak is a Serbian group and writes ekavian
  // — "dečake", "devojčice" — where the other four shops write ijekavian, and a rule built
  // only on "dječak" read "NIKE PATIKE AIR MAX MOTIF ZA DEČAKE" as having no audience at
  // all. The optional j is the whole difference.
  if (/(\bd[j]?e[cč](a|ij|ak|k)|d[j]?evoj[cč]|bebe|\bjr\b|junior)/.test(t)) return 'kids';
  if (/(za\s+[zž]ene|[zž]enske|\bw\b|wmns)/.test(t)) return 'women';
  if (/(za\s+mu[sš]karce|mu[sš]ke)/.test(t)) return 'men';
  if (/unisex/.test(t)) return 'unisex';
  return null;
}

/** The largest gallery image Magento lists, which is the product shot. */
function extractImage($: CheerioAPI, html: string): string | null {
  const match = html.match(
    /"mage\/gallery\/gallery"\s*:\s*\{[\s\S]*?"data"\s*:\s*(\[[\s\S]*?\])\s*,/,
  );
  if (match?.[1]) {
    try {
      const data = JSON.parse(match[1]) as { img?: string }[];
      const first = data.find((d) => d.img)?.img;
      if (first) return first;
    } catch {
      // fall through to the meta tag
    }
  }
  const meta = $('meta[property="og:image"]').attr('content')?.trim();
  return meta || null;
}

export function parseMagento2(html: string, url: string): ParsedOffer {
  const $ = cheerio.load(html);

  const title = $('h1').first().text().trim().replace(/\s+/g, ' ');
  if (!title) throw new ParseError('no product title', url);

  const config = findSwatchConfig($);
  if (!config) throw new ParseError('no Magento swatch jsonConfig found', url);

  const externalId = String(config.productId ?? '').trim();
  if (!externalId) throw new ParseError('swatch config carries no productId', url);

  // Identified as a product and readable — so an empty option set is a real sell-out
  // rather than a template that moved. See UnavailableError.
  const sizeAttribute = attributeList(config.attributes).find(
    (a) => a.code?.toLowerCase() === 'size',
  );
  const options = sizeAttribute?.options ?? [];
  if (options.length === 0) {
    throw new UnavailableError('product has no salable sizes', url);
  }

  const finalPrice = config.prices?.finalPrice?.amount;
  if (finalPrice === undefined || finalPrice <= 0) {
    throw new ParseError('swatch config carries no final price', url);
  }
  const oldPrice = config.prices?.oldPrice?.amount;

  const sizes: RawSize[] = options
    .map((o) => (o.label ?? '').trim())
    .filter((label) => label !== '')
    .map((label) => ({
      raw: label,
      euRaw: label,
      usRaw: null,
      ukRaw: null,
      // Magento omits what it cannot sell, so anything listed is available.
      inStock: true,
      gtin: null,
      priceRaw: null,
    }));

  if (sizes.length === 0) throw new ParseError('size options carry no labels', url);

  const parsed = {
    url,
    externalId,
    title,
    brand: extractBrand(title),
    // The manufacturer style code lives in the URL slug rather than any field on the
    // page: ".../puma-patike-puma-karmen-ii-jr-djevojcice-398878-01". It is what tier-2
    // matching joins on, so it is worth taking from the only place it appears.
    sku: extractSlugStyleCode(url),
    imageUrl: extractImage($, html),
    priceRaw: finalPrice.toFixed(2),
    // Only a genuine markdown. Magento repeats the final price in oldPrice on full-price
    // products, which would otherwise put the whole shop on sale at 0% off.
    originalPriceRaw: oldPrice !== undefined && oldPrice > finalPrice ? oldPrice.toFixed(2) : null,
    currency: 'BAM' as const,
    gender: extractGender(title),
    sizes,
  };

  const result = parsedOfferSchema.safeParse(parsed);
  if (!result.success) {
    throw new ParseError(`offer failed contract validation: ${result.error.message}`, url);
  }
  return result.data;
}

/**
 * The style code at the end of a product slug, e.g. "398878-01" or "hq6953".
 *
 * Anchored to the end because model names contain digit groups of their own — "karmen-ii"
 * and "327" would both be picked up by a looser search, and a wrong style code is worse
 * than none: tier 2 treats an equal code as proof two listings are the same shoe.
 */
export function extractSlugStyleCode(url: string): string | null {
  const slug = url.split('/').pop()?.split('?')[0] ?? '';
  const match = slug.match(/-([a-z0-9]{4,})(?:-(\d{2,3}))?$/i);
  if (!match) return null;
  const [, head, tail] = match;
  // A trailing word is not a code. Requiring a digit keeps "…-za-muskarce" out.
  if (!head || !/\d/.test(head)) return null;
  return (tail ? `${head}-${tail}` : head).toUpperCase();
}
