import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import { type ParsedOffer, type RawSize, parsedOfferSchema } from '@tike/contracts';
import { ParseError } from '../errors';

/**
 * Office Shoes.
 *
 * Bespoke platform run by the Office Shoes Group across the region (.ba, .rs, .hr, and
 * others), so this adapter is per-platform like the rest: the same code should onboard
 * their Croatian and Serbian sites when tike expands, as a config row.
 *
 * Identity comes from schema.org **microdata**, not JSON-LD — `itemprop` attributes on
 * the page rather than a JSON blob. The vocabulary is the same, so the extracted fields
 * match the NBSHOP adapter's; only the reading differs.
 *
 * Two things this shop does that the parser has to respect:
 *
 * 1. **Only in-stock sizes are rendered.** A shoe listing 41, 42, 44, 45 is not missing
 *    43 by accident — 43 is sold out and simply absent, with no greyed-out entry. So
 *    every size here is `inStock: true`, and tike cannot say "this shop has the shoe but
 *    not in your size" for Office Shoes the way it can for NBSHOP.
 *
 * 2. **Unknown paths answer 200 with the homepage**, not 404. A soft-404 therefore looks
 *    like a successful fetch, and would parse as an offer with no sizes. The missing
 *    Product scope is what catches it, and it must stay a hard error.
 */

/** The product subtree everything is read from. */
type Scope = ReturnType<CheerioAPI>;

/** Only in-stock sizes appear, so a listed size is an available one. */
const ALL_LISTED_SIZES_ARE_IN_STOCK = true;

export function parseOfficeshoes(html: string, url: string): ParsedOffer {
  const $ = cheerio.load(html);

  // Everything is read from inside the product scope. The page also carries "you may
  // also like" carousels with their own prices and old prices; the NBSHOP adapter was
  // bitten by exactly that, picking up 155 sizes for a 15-size shoe.
  const scope = $('[itemtype="http://schema.org/Product"]').first();
  if (scope.length === 0) {
    throw new ParseError(`no schema.org Product microdata found`, url);
  }

  const prop = (name: string): string | null => {
    const el = scope.find(`[itemprop="${name}"]`).first();
    if (el.length === 0) return null;
    const value = el.attr('content') ?? el.text();
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  };

  // The brand carries its own nested itemprop="name", and it comes first in the DOM, so
  // a naive lookup for "name" returns "Guess" rather than the model.
  const brand = scope.find('[itemprop="brand"] [itemprop="name"]').first().text().trim() || null;
  const productName = scope
    .find('[itemprop="name"]')
    .filter((_, el) => $(el).closest('[itemprop="brand"]').length === 0)
    .first()
    .text()
    .trim();

  // `itemprop="model"` holds "Plitke patike" — the shop's shoe *type*, not a model name,
  // and the actual model is in `name`. Folding the type into the title would put the same
  // noise word on every Office Shoes offer and drag down every cross-shop title
  // comparison, so it is dropped rather than cleaned up later.
  const title = [brand, productName].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  if (title === '') throw new ParseError(`no product title`, url);

  const externalId = lastPathSegment(url);
  if (!externalId) throw new ParseError(`no product id in url`, url);

  const priceRaw = prop('price');
  if (!priceRaw) throw new ParseError(`no price`, url);

  const sizes = extractSizes($, scope);
  if (sizes.length === 0) {
    // Contract: an offer with no sizes is a parse failure, never an out-of-stock shoe.
    throw new ParseError(`no sizes found`, url);
  }

  return parsedOfferSchema.parse({
    url,
    externalId,
    title,
    brand,
    sku: prop('sku'),
    imageUrl: prop('image'),
    priceRaw,
    originalPriceRaw: extractOriginalPrice(scope),
    currency: prop('priceCurrency') === 'EUR' ? 'EUR' : 'BAM',
    gender: detectGender(prop('description'), title),
    sizes,
  });
}

/**
 * `<ul class="sizes"><li data-product-size="42.5">42,5</li></ul>`.
 *
 * The per-size `rel` attribute holds the shop's internal stock figure. It is deliberately
 * ignored: tike stores availability, not quantities, and a shop's stock count is
 * commercially sensitive in a way a size list is not.
 */
function extractSizes($: CheerioAPI, scope: Scope): RawSize[] {
  const seen = new Set<string>();
  const out: RawSize[] = [];

  scope.find('ul.sizes li[data-product-size]').each((_, el) => {
    const raw = ($(el).attr('data-product-size') ?? '').trim();
    if (raw === '' || seen.has(raw)) return;
    seen.add(raw);
    out.push({
      raw,
      euRaw: raw,
      usRaw: null,
      ukRaw: null,
      inStock: ALL_LISTED_SIZES_ARE_IN_STOCK,
      gtin: null,
      priceRaw: null,
    });
  });

  return out;
}

/**
 * `<span class="old-price">Stara cijena: <span class="line-through">195,00 KM</span></span>`
 *
 * Read from the product scope only. Listing carousels elsewhere on the page use a
 * different shape (`data-old` / `data-new`) whose two values are always equal, so they
 * would answer with a fake discount for every product on the page.
 */
function extractOriginalPrice(scope: Scope): string | null {
  const text = scope.find('.old-price .line-through').first().text().trim();
  if (text === '') return null;
  const match = text.match(/[\d.,]+/);
  return match ? match[0] : null;
}

/**
 * The shop states this outright in the product description — " Muške patike".
 *
 * Falling back to the title matters because gender guards matching: a kids shoe must
 * never merge into its adult namesake.
 */
function detectGender(description: string | null, title: string): ParsedOffer['gender'] {
  const haystack = `${description ?? ''} ${title}`.toLowerCase();
  if (/\bdje[cč]ij|\bdje[cč]j|\bkids?\b/.test(haystack)) return 'kids';
  if (/\bmu[sš]k/.test(haystack)) return 'men';
  if (/\b[zž]ensk/.test(haystack)) return 'women';
  if (/\bunisex\b/.test(haystack)) return 'unisex';
  return null;
}

function lastPathSegment(url: string): string | null {
  try {
    const segments = new URL(url).pathname.split('/').filter(Boolean);
    return segments.at(-1) ?? null;
  } catch {
    return null;
  }
}
