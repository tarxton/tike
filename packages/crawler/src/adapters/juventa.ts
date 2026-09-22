import { type Gender, type ParsedOffer, type RawSize, parsedOfferSchema } from '@tike/contracts';
import { ParseError } from '../errors';
import { brandLogoUrl } from './brand-logo';

/**
 * Juventa Sport (juventasport.com, Banja Luka).
 *
 * A Vue storefront whose every page is an empty shell, so there is no markup to read: the
 * data lives in the JSON API the storefront itself calls. That turns out to be the
 * cleanest source tike has. `/getItems` lists products twenty at a time and
 * `/getProduct/{id}` answers with the manufacturer's style code, the price and the price
 * it was reduced from as numbers, and every size with an `available` flag, sold-out sizes
 * included.
 *
 * The parser is therefore handed JSON rather than HTML, and the URL it is fetched from is
 * the API's. The offer's own URL is the storefront page a shopper can open, because that
 * is where the outclick has to land.
 */

/** One entry in `/getItems`. Only what discovery needs. */
interface ListingItem {
  id?: number | string;
}

interface ListingResponse {
  products?: { page?: number; per_page?: number; total?: number; data?: ListingItem[] };
}

interface ProductResponse {
  id?: number | string;
  name?: string;
  sku?: string | null;
  price?: number | string | null;
  original_price?: number | string | null;
  hero?: string | null;
  images?: Record<string, string> | string[] | null;
  brand?: { name?: string | null; logo?: string | null } | null;
  options?: { size?: string | null; eu_size?: string | null; available?: boolean }[] | null;
}

/** `/getItems?type_id[]=9000&type_id[]=8980&page=3` */
export function juventaListingUrl(baseUrl: string, typeIds: string[], page: number): string {
  const url = new URL('/getItems', baseUrl);
  for (const id of typeIds) url.searchParams.append('type_id[]', id);
  url.searchParams.set('page', String(page));
  return url.href;
}

/** Where the parser reads one product from. */
export function juventaProductApiUrl(baseUrl: string, id: string): string {
  return new URL(`/getProduct/${encodeURIComponent(id)}`, baseUrl).href;
}

/** The storefront page for one product: what a shopper opens, and what the outclick targets. */
export function juventaProductPageUrl(baseUrl: string, id: string): string {
  return new URL(`/product/${encodeURIComponent(id)}`, baseUrl).href;
}

/**
 * One page of the listing: its product ids and whether more pages follow.
 *
 * "Last page" is read from the shop's own total rather than from an empty page, because
 * the total is what the storefront's pager uses, and an empty page is only reached one
 * request later.
 */
export function parseJuventaListing(
  json: string,
  page: number,
): { ids: string[]; total: number; last: boolean } {
  let body: ListingResponse;
  try {
    body = JSON.parse(json) as ListingResponse;
  } catch {
    throw new Error(`Juventa listing page ${page} is not JSON`);
  }
  const products = body.products;
  if (!products || !Array.isArray(products.data)) {
    throw new Error(`Juventa listing page ${page} has no products array`);
  }
  const ids = products.data
    .map((item) => (item.id === undefined ? '' : String(item.id).trim()))
    .filter((id) => id !== '');
  const total = Number(products.total ?? 0);
  const perPage = Number(products.per_page ?? ids.length);
  return { ids, total, last: ids.length === 0 || page * perPage >= total };
}

export function parseJuventa(json: string, url: string): ParsedOffer {
  let product: ProductResponse;
  try {
    product = JSON.parse(json) as ProductResponse;
  } catch {
    throw new ParseError('response is not JSON', url);
  }

  const externalId = product.id === undefined ? '' : String(product.id).trim();
  if (!externalId) throw new ParseError('product carries no id', url);

  const name = (product.name ?? '').replace(/\s+/g, ' ').trim();
  if (!name) throw new ParseError('product carries no name', url);

  const price = toNumber(product.price);
  if (price === null || price <= 0) throw new ParseError('product carries no price', url);
  const original = toNumber(product.original_price);

  const sizes = extractSizes(product.options);
  if (sizes.length === 0) {
    // Contract: an offer with no sizes is a parse failure, never an out-of-stock shoe.
    // Juventa lists sold-out sizes with `available: false`, so a real sell-out still
    // arrives with sizes and is written as out of stock rather than skipped.
    throw new ParseError('product lists no sizes', url);
  }

  const images = extractImages(product, url);
  const brand = product.brand?.name?.trim() || null;
  const sku = product.sku?.trim() || null;
  // A few names are nothing but audience and use ("Muške patike za trčanje", 18 ANTA
  // listings in the 2026-09-21 survey), and the style code is then the only thing that
  // tells one shoe from the next.
  const model = extractModel(name) || sku || name;

  const parsed = {
    url: juventaProductPageUrl(url, externalId),
    externalId,
    // Brand and model, the way the other adapters' titles read once their category and
    // audience words are stripped. The audience is not lost: it is the gender below.
    title: [brand, model].filter(Boolean).join(' '),
    brand,
    sku,
    imageUrl: images[0] ?? null,
    imageUrls: images,
    // The API names the brand's logo on every product, as the storefront's brand pages use it.
    brandLogoUrl: brandLogoUrl(product.brand?.logo, url),
    priceRaw: price.toFixed(2),
    // Only a genuine markdown; the API repeats the price here on full-price products.
    originalPriceRaw: original !== null && original > price ? original.toFixed(2) : null,
    currency: 'BAM' as const,
    gender: extractGender(name),
    sizes,
  };

  const result = parsedOfferSchema.safeParse(parsed);
  if (!result.success) {
    throw new ParseError(`offer failed contract validation: ${result.error.message}`, url);
  }
  return result.data;
}

/**
 * `{ size: "40 2/3", eu_size: "40 2/3", available: false }`, one per size.
 *
 * Sold-out sizes are kept: they are what lets tike say "this shop has the shoe, just not
 * in your size". The EU label is preferred and the plain label is the fallback, because
 * the two only differ where a shop has typed one of them in.
 */
function extractSizes(options: ProductResponse['options']): RawSize[] {
  if (!Array.isArray(options)) return [];
  const seen = new Set<string>();
  const out: RawSize[] = [];
  for (const option of options) {
    const raw = (option.eu_size ?? option.size ?? '').trim();
    if (raw === '' || seen.has(raw)) continue;
    seen.add(raw);
    out.push({
      raw,
      euRaw: raw,
      usRaw: null,
      ukRaw: null,
      inStock: option.available === true,
      gtin: null,
      priceRaw: null,
    });
  }
  return out;
}

/**
 * The hero picture first, then the gallery, as absolute URLs.
 *
 * The hero is the one the storefront opens on and the one its own listing shows, so it
 * is the shop's choice of main picture. The gallery follows in its own key order, without
 * repeating the hero.
 */
function extractImages(product: ProductResponse, url: string): string[] {
  const gallery = Array.isArray(product.images)
    ? product.images
    : Object.entries(product.images ?? {})
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([, path]) => path);
  const out: string[] = [];
  for (const path of [product.hero, ...gallery]) {
    if (typeof path !== 'string' || path.trim() === '') continue;
    const absolute = new URL(path.trim(), url).href;
    if (!out.includes(absolute)) out.push(absolute);
  }
  return out;
}

/**
 * Who the shoe is for. Juventa opens every name with it — "Muške patike …", "Ženske
 * patike …", "Dječije patike …", "Unisex patike …" — and types it by hand. The survey of
 * 1.574 sneaker names found "M uške", "Muzške", "uške", "Muška", "Ženska", "Žesnke",
 * "Žemske", "Zženske", "Ženskje", "Dječija", "Djječije", "Djećije" and "ječije".
 *
 * So the audience word is read by its shape rather than its spelling: the letters before
 * the category word, spaces dropped, then its first letter or its "ječ" core. Spelling it
 * out would miss the next typo, and a child's shoe read as nobody's is the one mistake
 * matching cannot afford: it is what lets a toddler size merge into an adult listing.
 * Children are checked first, as in every adapter.
 */
export function extractGender(name: string): Gender | null {
  // A few names are the shop's internal form, "Z PATIKE LS UNO LITE …", which opens with
  // an audience code rather than a word: M, Z, DJ, U.
  const code = name.match(/^(DJ|M|Z|U)(?=\s)/)?.[1];
  if (code) return ({ DJ: 'kids', M: 'men', Z: 'women', U: 'unisex' } as const)[code] ?? null;

  const head = (name.split(/[Pp]ati|apti|kopa|cipel|perf|runn|ko[sš]ark|\p{Lu}{2}/u)[0] ?? '')
    .toLowerCase()
    .replace(/[^\p{L}]/gu, '');
  if (/^unise/.test(head)) return 'unisex';
  if (/^d|je[cčć]|bebe/.test(head)) return 'kids';
  if (/^[zž]/.test(head)) return 'women';
  if (/^m|^u[sšz]/.test(head)) return 'men';
  return null;
}

/**
 * The model, out of a name built as audience, category, description, then the model:
 * "Muške patike za trčanje GALAXY 8", "Ženske patike performance running CLOUDSURFER
 * TRAIL 2 WATERPROOF", "Muške košarkaške patike LEBRON WITNESS IX".
 *
 * The description is what has to go. It is Juventa's own wording, no other shop writes
 * it, and left in it would make "Za Trčanje Galaxy 8" a different shoe from everyone
 * else's "Galaxy 8". So the model is everything after the category word, less the
 * all-lowercase words that open it. Not "the capitals at the end": models carry lowercase
 * of their own ("VL COURT 00s", "AERO BLAZE 3 gravel GTX", "Field Jupiter Engineered 2"),
 * and reading only the capitals cut the last one down to "2".
 *
 * "INDOOR", "TURF", "TREK" and "TRAIL SHOES" open some models as the shop's type label
 * ("INDOOR TIEMPO STREETGATO"); the model's own suffix, IC or TF, already says it where
 * it matters. The shop's typos are real rows too, and all of these parse:
 * "patikeTURF PHANTOM 6" with the space missing, "patikeS UNO RUGGED" with a stray capital
 * glued on, and "AIR MAX FIRE)" with a stray bracket. Eighteen names are the shop's
 * internal form instead ("Z PATIKE LS RUN 70S 2.0 FTWWHT/CBLACK/GREONE"): the category in
 * capitals, a type code, and a colour list at the end.
 */
export function extractModel(name: string): string {
  // "patikeTURF" -> "patike TURF". Two capitals at least, so a lone stray capital glued to
  // the category word ("patikeS UNO") stays with it and goes when the category word goes.
  const spaced = name.replace(/(\p{Ll})(\p{Lu}{2,})/gu, '$1 $2');
  const category = spaced.match(
    /(?:[Pp]ati[kc]|aptik|kopa[cč]k|cipel)\p{Ll}*(?:\p{Lu}(?=\s))?|PATI[KC][AE](?=\s)/u,
  );
  let model = category ? spaced.slice((category.index ?? 0) + category[0].length) : spaced;

  const words = model.trim().split(/\s+/);
  while (words.length > 0 && !/\p{Lu}|\d/u.test(words[0]!)) words.shift();
  model = words.join(' ');

  // LS and GS are the shop's own codes (lifestyle, grade school) in its internal names.
  model = model.replace(/^(?:LS|GS)\s+(?=\S)/, '');
  model = model.replace(/^(?:INDOOR|TURF|TREK|TRAIL SHOES)\s+(?=\S)/, '');
  // Internal names end in the colourway as a slash list: "FTWWHT/CBLACK/GREONE".
  model = model.replace(/\s+\S*\/\S*$/, '');
  if (!model.includes('(')) model = model.replace(/\)/g, '');
  return model.replace(/\s+/g, ' ').trim();
}

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
