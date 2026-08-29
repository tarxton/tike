import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import { parsedOfferSchema, type Gender, type ParsedOffer, type RawSize } from '@tike/contracts';

/**
 * NBSHOP adapter.
 *
 * NBSHOP is the platform behind several BiH retailers (buzzsneakers.ba runs 5.9.58,
 * sportvision.ba runs 7), so one adapter covers all of them. Confirmed by identical
 * robots.txt layout, identical sitemap paths, and identical product markup.
 *
 * Two sources are combined:
 *   - schema.org Product JSON-LD for identity and price
 *   - the size list in the DOM for per-size availability, which JSON-LD does not carry
 */

export class ParseError extends Error {
  constructor(
    message: string,
    readonly url: string,
  ) {
    super(`${message} (${url})`);
    this.name = 'ParseError';
  }
}

interface JsonLdProduct {
  '@type'?: string;
  name?: string;
  sku?: string;
  productID?: string | number;
  gtin13?: string;
  image?: string | string[];
  brand?: string | { name?: string };
  offers?: {
    price?: string | number;
    priceCurrency?: string;
    availability?: string;
  };
}

/**
 * NBSHOP pages contain several JSON-LD blocks, and at least one is a commented-out
 * template full of empty placeholders. Parse defensively and keep the first block
 * that is a Product with a name.
 */
function findProductJsonLd($: CheerioAPI): JsonLdProduct | null {
  for (const el of $('script[type="application/ld+json"]').toArray()) {
    const raw = $(el).contents().text().trim();
    if (!raw) continue;
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      continue; // malformed or templated block
    }
    const candidates = Array.isArray(data) ? data : [data];
    for (const c of candidates) {
      const product = c as JsonLdProduct;
      if (product?.['@type'] === 'Product' && product.name) return product;
    }
  }
  return null;
}

function brandName(brand: JsonLdProduct['brand']): string | null {
  if (!brand) return null;
  if (typeof brand === 'string') return brand.trim() || null;
  return brand.name?.trim() || null;
}

function firstImage(image: JsonLdProduct['image']): string | null {
  const value = Array.isArray(image) ? image[0] : image;
  return value?.trim() || null;
}

/**
 * Sizes for the *main* product only.
 *
 * The page also renders recommendation carousels, each with its own size widget under
 * `.sizes-inner-wrapper`. Selecting those too would attach dozens of phantom sizes —
 * including children's sizes on an adult product — to the offer. The main product's
 * list is `ul.product-attributes`, and the `.product-item` guard keeps it that way
 * even if a future template nests one.
 */
function extractSizes($: CheerioAPI): RawSize[] {
  return $('ul.product-attributes li')
    .filter((_, li) => $(li).closest('.product-item').length === 0)
    .map((_, li) => {
      const $li = $(li);
      const classes = $li.attr('class') ?? '';
      const tooltip = $li.attr('data-original-title') ?? '';

      const euRaw = $li.find('.eur-size').text().trim() || tooltipValue(tooltip, 'EU');
      const usRaw = $li.find('.original-size').text().trim() || tooltipValue(tooltip, 'US');
      const ukRaw = tooltipValue(tooltip, 'UK');

      const size: RawSize = {
        // The shop's own label, which for kids' shoes is a US-style code like "11C".
        raw: $li.attr('data-productsize-name')?.trim() || usRaw || euRaw || '',
        euRaw: euRaw || null,
        usRaw: usRaw || null,
        ukRaw: ukRaw || null,
        // `disabled` marks a size the shop cannot sell right now.
        inStock: !classes.includes('disabled'),
        // NBSHOP puts a per-size barcode here, which enables exact matching.
        gtin: $li.attr('data-combination-code')?.trim() || null,
        priceRaw: $li.attr('data-productsize-price')?.trim() || null,
      };
      return size;
    })
    .toArray()
    .filter((s) => s.raw !== '');
}

/**
 * The pre-sale price, when the shop is running one.
 *
 * NBSHOP carries `data-productsize-oldprice` on each size row alongside
 * `data-productsize-price`. On a full-price product the two are equal, so the old
 * price is only reported when it is genuinely higher — otherwise every listing would
 * render as "on sale, 0% off".
 */
function extractOriginalPrice($: CheerioAPI, priceRaw: string): string | null {
  const current = toNumber(priceRaw);
  let best: number | null = null;

  for (const li of $('ul.product-attributes li').toArray()) {
    const old = toNumber($(li).attr('data-productsize-oldprice') ?? '');
    if (old === null) continue;
    if (current !== null && old <= current) continue;
    best = best === null ? old : Math.max(best, old);
  }

  return best === null ? null : best.toFixed(2);
}

/** "259,00" and "259.00" both mean 259. */
function toNumber(raw: string): number | null {
  const cleaned = raw.trim().replace(/\s/g, '');
  if (!cleaned) return null;
  const normalized = /,\d{2}$/.test(cleaned)
    ? cleaned.replace(/\./g, '').replace(',', '.')
    : cleaned.replace(/,/g, '');
  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Reads "Veličina EU: 41<br />Veličina UK: 7<br />" style tooltips. */
function tooltipValue(tooltip: string, system: 'EU' | 'UK' | 'US'): string {
  const match = tooltip.match(new RegExp(`Veli[čc]ina ${system}:\\s*([^<]+)`, 'i'));
  return match?.[1]?.trim() ?? '';
}

/**
 * Gender is not in the JSON-LD, so it comes from the breadcrumb and title, both of
 * which are in Bosnian. Returns null rather than guessing — an unknown gender is
 * better than a wrong one, since it drives both filtering and size conversion.
 */
function extractGender($: CheerioAPI, title: string): Gender | null {
  const haystack = `${$('.breadcrumb').text()} ${title}`.toLowerCase();
  if (/\b(bebe|djec|dje[čc]|kids|junior|\bbp\b|\bps\b|\btd\b|\bgs\b)/.test(haystack)) return 'kids';
  if (/\b(zene|žene|ženske|zenske|women|\bw\b|wmns)/.test(haystack)) return 'women';
  if (/\b(muskarce|muškarce|muške|muske|men|\bm\b)/.test(haystack)) return 'men';
  if (/\bunisex\b/.test(haystack)) return 'unisex';
  return null;
}

export function parseNbshop(html: string, url: string): ParsedOffer {
  const $ = cheerio.load(html);

  const ld = findProductJsonLd($);
  if (!ld) throw new ParseError('no schema.org Product JSON-LD found', url);

  const externalId = String(ld.productID ?? '').trim();
  if (!externalId) throw new ParseError('product has no productID', url);

  const priceRaw = ld.offers?.price === undefined ? '' : String(ld.offers.price).trim();
  if (!priceRaw) throw new ParseError('product has no price', url);

  const title = ld.name?.trim() ?? '';
  const sizes = extractSizes($);

  const currency = ld.offers?.priceCurrency?.trim().toUpperCase();

  const parsed = {
    url,
    externalId,
    title,
    brand: brandName(ld.brand),
    sku: ld.sku?.trim() || null,
    imageUrl: firstImage(ld.image),
    priceRaw,
    originalPriceRaw: extractOriginalPrice($, priceRaw),
    currency: currency === 'EUR' ? ('EUR' as const) : ('BAM' as const),
    gender: extractGender($, title),
    sizes,
  };

  // Validate at the boundary so a markup change surfaces as a typed failure here,
  // rather than as bad data three stages downstream.
  const result = parsedOfferSchema.safeParse(parsed);
  if (!result.success) {
    throw new ParseError(`offer failed contract validation: ${result.error.message}`, url);
  }
  return result.data;
}
