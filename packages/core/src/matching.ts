import { normalizeForSearch } from './text';

/**
 * Deciding when two shop listings are the same shoe.
 *
 * Ordered strategies, strongest first. Anything below the fuzzy threshold is left
 * unmatched for human review rather than guessed at: an unmerged duplicate is untidy,
 * but a wrong merge shows one shoe's price on another shoe's page and destroys trust.
 */

export type MatchMethod = 'gtin' | 'style_code' | 'fuzzy' | 'manual';

export interface MatchCandidate {
  offerId: number;
  /** Two listings in the same shop are different products unless a code proves otherwise. */
  shopId?: number;
  brand: string | null;
  /** Model with brand and category noise already stripped. */
  model: string;
  sku: string | null;
  gtin?: string | null;
  gender: string | null;
  /** In-stock and out-of-stock EU sizes; used to tell adult from children's shoes. */
  sizesEu: number[];
}

export interface MatchResult {
  method: MatchMethod;
  confidence: number;
}

/** Above this, a fuzzy pair is accepted automatically. Below, it goes to review. */
export const FUZZY_ACCEPT = 0.82;
/** Below this, a pair is not even worth queueing. */
export const FUZZY_REVIEW_FLOOR = 0.6;

/**
 * Manufacturer style codes as a comparable key.
 *
 * `DV0787-100`, `DV0787 100` and `dv0787100` are the same code written three ways.
 * Shops also pad with their own suffixes, so only the leading code is used.
 */
export function normalizeStyleCode(sku: string | null): string | null {
  if (!sku) return null;
  const cleaned = sku.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return cleaned.length >= 5 ? cleaned : null;
}

/**
 * The model part of a style code, with the colourway suffix removed.
 *
 * Nike, Hoka, Asics and Skechers all write BASE-COLOUR (`IB1857-203`, `1176572-FLCK`),
 * so two codes sharing a base are one shoe in two colours while different bases are
 * different shoes. New Balance (`U7408XH`) and adidas (`KI9403`) encode the colour
 * inline with no separator, so the whole code stands as the base — which is strict, and
 * strict is the safe direction here.
 */
export function styleCodeBase(sku: string | null): string | null {
  if (!sku) return null;
  const trimmed = sku.trim().toUpperCase();
  const cut = trimmed.lastIndexOf('-');
  const base = cut > 0 ? trimmed.slice(0, cut) : trimmed;
  const cleaned = base.replace(/[^A-Z0-9]/g, '');
  return cleaned.length >= 5 ? cleaned : null;
}

/**
 * Children's shoes share model names with adult ones — adidas sells "Campus 00s" and
 * "Campus 00s C", and their titles are 0.69 similar. Merging them would put a toddler
 * shoe in front of someone filtering size 44.
 *
 * Size ranges are the reliable signal: children's shoes top out well below adult ones.
 */
export function sizeRangesOverlap(a: number[], b: number[]): boolean {
  if (a.length === 0 || b.length === 0) return false;

  // Compare the actual size sets, not just their extremes. A junior listing running
  // 28-40 shares a boundary with an adult 38-48 one, and a min/max test waves it
  // through — which then chains kids and adult shoes together through union-find.
  const setB = new Set(b);
  const shared = a.filter((s) => setB.has(s)).length;
  const smaller = Math.min(a.length, b.length);
  return shared / smaller >= 0.5;
}

/**
 * A shoe does not run from toddler to adult. When a merged group spans that far,
 * something has chained separate products together and the group must be rejected.
 */
export const MAX_PLAUSIBLE_SIZE_SPAN = 14;

export function isPlausibleSizeSpan(sizes: number[]): boolean {
  if (sizes.length === 0) return true;
  return Math.max(...sizes) - Math.min(...sizes) <= MAX_PLAUSIBLE_SIZE_SPAN;
}

/** Gender must not contradict. Unknown on either side is not a contradiction. */
export function gendersCompatible(a: string | null, b: string | null): boolean {
  if (!a || !b) return true;
  if (a === b) return true;
  // "unisex" sits with anything adult, but never with kids.
  const adult = new Set(['men', 'women', 'unisex']);
  return adult.has(a) && adult.has(b);
}

/**
 * Trigram-style similarity on two normalized strings.
 *
 * Postgres does this in the database for candidate generation; this mirror exists so
 * the decision itself is pure, unit-testable, and identical wherever it runs.
 */
export function similarity(a: string, b: string): number {
  const left = trigrams(normalizeForSearch(a));
  const right = trigrams(normalizeForSearch(b));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const t of left) if (right.has(t)) shared += 1;
  return shared / (left.size + right.size - shared);
}

function trigrams(input: string): Set<string> {
  const padded = `  ${input.replace(/\s+/g, ' ').trim()} `;
  const out = new Set<string>();
  for (let i = 0; i < padded.length - 2; i += 1) out.add(padded.slice(i, i + 3));
  return out;
}

/**
 * Decide whether two listings are the same shoe.
 *
 * Returns null when they are not, or when the evidence is too weak to act on. Callers
 * treat a `fuzzy` result below FUZZY_ACCEPT as a review-queue item, not a match.
 */
export function matchOffers(a: MatchCandidate, b: MatchCandidate): MatchResult | null {
  if (a.offerId === b.offerId) return null;

  // Tier 1: a shared barcode is conclusive regardless of how the titles read.
  if (a.gtin && b.gtin && a.gtin === b.gtin) {
    return { method: 'gtin', confidence: 1 };
  }

  // Tier 2: the manufacturer's own style code.
  const codeA = normalizeStyleCode(a.sku);
  const codeB = normalizeStyleCode(b.sku);
  if (codeA && codeB && codeA === codeB) {
    return { method: 'style_code', confidence: 0.99 };
  }

  // Tier 3: same brand, similar model, and nothing contradicting it.
  //
  // Never fuzzy-merge within one shop. A shop does not list the same product twice, so
  // two similar titles in the same catalogue are different colourways — "NBC" in black
  // and "NBC" in white are two products, and merging them hides one from the shopper.
  if (a.shopId !== undefined && a.shopId === b.shopId) return null;

  // A code the manufacturer assigned outranks anything the title says. When both sides
  // carry one and the model parts differ, these are different shoes however alike the
  // names read: Sport Vision's "Nike Pegasus" (HV8121-200, 325 KM) and Buzz's "Nike
  // Patike Pegasus" (IQ3435-045, 475 KM) score 1.0 on the title and are not the same
  // shoe. Without this the fuzzy tier reads a stripped model name as the whole identity.
  const baseA = styleCodeBase(a.sku);
  const baseB = styleCodeBase(b.sku);
  if (baseA && baseB && baseA !== baseB) return null;

  if (!a.brand || !b.brand) return null;
  if (normalizeForSearch(a.brand) !== normalizeForSearch(b.brand)) return null;
  if (!gendersCompatible(a.gender, b.gender)) return null;
  if (!sizeRangesOverlap(a.sizesEu, b.sizesEu)) return null;

  const score = similarity(a.model, b.model);
  if (score < FUZZY_REVIEW_FLOOR) return null;
  return { method: 'fuzzy', confidence: Number(score.toFixed(3)) };
}

/** True when a fuzzy result is strong enough to merge without a human looking. */
export function isAutoMergeable(result: MatchResult): boolean {
  if (result.method === 'gtin' || result.method === 'style_code') return true;
  return result.confidence >= FUZZY_ACCEPT;
}
