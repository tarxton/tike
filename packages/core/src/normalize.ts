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

/**
 * Category words shops put in the title; they carry no product information.
 *
 * The boundaries are `\p{L}` lookarounds rather than `\b`, because `\b` is defined on
 * ASCII word characters: in " OBUĆA" the space and the Ć are both non-word to it, so no
 * boundary exists there and the pattern silently never matches.
 */
const CATEGORY_NOISE = /(?<!\p{L})(?:patike|tenisice|obu[cć]a|cipele|sneakers?|shoes)(?!\p{L})/giu;

/**
 * Who the shoe is for, as Đak writes it into every title: "NIKE PATIKE AIR PRESTO ZA
 * MUŠKARCE", "SKECHERS PATIKE UNO ŽENE".
 *
 * Audience is not identity — tike stores it in `gender`, filters on it, and shows it as a
 * chip — so repeating it inside the name only makes one shop's cards shout a fact the
 * page already carries. Measured before it was written: of 9.607 offers, only Đak's 1.753
 * titles match this at all, so it costs the other four shops nothing.
 *
 * Both alphabets of every word. Đak is a Serbian group and writes ekavian ("DEČAKE",
 * "DEVOJČICE") where the other shops write ijekavian, its own titles disagree about
 * diacritics ("ZA ZENE" beside "ZA ŽENE"), and 5 of them arrived mojibaked as "DE?AKE" —
 * hence the `?` inside the character classes. Those are real rows, not hypotheticals.
 */
const AUDIENCE_NOISE =
  /(?<!\p{L})(?:za\s+)?(?:mu[sš]karc[ei]|mu[sš]k[ei]|[zž]enske|[zž]en[aeu]|dj?e[cč?](?:aci|ak[aei]?|ij[aei])|dj?evoj[cč?]ic[ae]|dj?ec[au]|bebe|unisex)(?!\p{L})/giu;

/** "DJEČACI UZRASTA 0-4 GODINE" — an age band, and no more part of the name than the rest. */
const AGE_NOISE = /(?<!\p{L})uzrasta[\s\d.,–-]+godin[aei]?(?!\p{L})/giu;

/**
 * Strip the brand, the category word and the audience from a shop title.
 *
 * Noise comes off first and the brand second, because the brand is only taken off the
 * front and Đak parks an audience word between two copies of it.
 *
 * The result is never empty. "REPLAY PATIKE ZA MUŠKARCE" is a real listing whose title
 * says nothing but brand, category and audience; stripping all three leaves nothing to
 * put on a card, and before this it left the literal string "ZA MUŠKARCE" as the model.
 * When everything strips away the category word comes back as the name, because "Patike"
 * is then genuinely all the shop has said about it.
 */
export function cleanModel(title: string, brand: string | null): string {
  const stripped = collapse(
    title.replace(CATEGORY_NOISE, ' ').replace(AGE_NOISE, ' ').replace(AUDIENCE_NOISE, ' '),
  );

  const withoutBrand = stripLeadingBrand(stripped, brand);
  if (withoutBrand) return titleCase(withoutBrand);

  const category = title.match(CATEGORY_NOISE)?.[0];
  return titleCase(category || stripped || title.trim());
}

/**
 * Take the brand off the front, as many times as it is there.
 *
 * Repeatedly, because NBSHOP writes the brand twice — "Nike Patike NIKE DUNK LOW RETRO"
 * is one brand, one category word, one brand, then the model — and Đak sometimes writes
 * it twice with an audience word between them.
 *
 * Only from the front, which is the correction to the version that removed it wherever it
 * appeared: some models carry the brand inside the name, and "Jordan Patike Air Jordan 1
 * Zoom Air" came out as "Air 1 Zoom Air". A brand in the middle of a name is part of the
 * name — Nike's own "W Nike Pacific" is another — while a brand at the front is the
 * prefix every shop puts there.
 */
function stripLeadingBrand(model: string, brand: string | null): string {
  if (!brand) return model;
  const leading = new RegExp(`^${escapeRegExp(brand)}(?!\\p{L})`, 'iu');
  let out = model;
  for (let seen = ''; out !== seen;) {
    seen = out;
    out = collapse(out.replace(leading, ''));
  }
  return out;
}

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * Whether a model is the fallback rather than a name.
 *
 * `cleanModel` returns the category word when a title contains nothing else — "REPLAY
 * PATIKE ZA MUŠKARCE" becomes "Patike". That is the honest answer for one listing and the
 * wrong one for a group: matching picks the shortest model in a cluster as the product's
 * name, and "Patike" is shorter than every real name there is.
 */
export function isPlaceholderModel(model: string): boolean {
  return collapse(model.replace(CATEGORY_NOISE, ' ')) === '';
}

/**
 * Give a shouted name ordinary capitals, and leave every other name alone.
 *
 * Shops disagree about case — Đak writes every title in capitals, Sport Vision and Sport
 * Reality shout the model half, Office Shoes does not — and a grid mixing "Air Jordan 1
 * Zoom Air" with "AIR MAX MOTIF" reads as a fault in the site rather than a difference
 * between two retailers. 2.995 of 9.607 offers are affected.
 *
 * Only a name written *entirely* in capitals is being shouted, so a mixed-case name is
 * returned untouched: this cannot damage a shop that already capitalises sensibly.
 */
export function titleCase(input: string): string {
  if (input !== input.toUpperCase() || !/\p{Lu}/u.test(input)) return input;
  return input.replace(/[\p{L}\p{N}'’.]+/gu, (token) =>
    keepsItsCapitals(token) ? token : capitalize(token),
  );
}

/**
 * Whether a token is a code rather than a word.
 *
 * Model names are full of them — GTX, TF, VL, RS-X, II, 3.0, '07 — and "Nike Air Max Tf"
 * is a worse answer than leaving the whole thing shouting. Four rules, in order of how
 * often they fire on this catalogue, and each one is a shape rather than a list of
 * remembered acronyms, because a list would silently rot as shops add models.
 *
 * The numeral rule is deliberately only I, V and X: the full Roman alphabet spells "MID",
 * which is three letters of it and a word Nike puts on half its catalogue.
 */
function keepsItsCapitals(token: string): boolean {
  if (/\d/.test(token)) return true; // 90, 3.0, '07, 2A3
  if (token.length <= 2) return true; // TF, VL, JR, IC, EL, HI, W
  if (!/[AEIOU]/.test(token)) return true; // GTX, HML, PRM, WMNS
  return /^[IVX]{1,4}$/.test(token); // II, III, IV, VI, IX
}

function capitalize(token: string): string {
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
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
