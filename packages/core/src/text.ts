/**
 * Text normalization for a single-variant BCS locale.
 *
 * Search must work for people typing without diacritics: `muske patike` has to
 * find `muške patike`. Folding happens on both the indexed document and the
 * query, never only one side.
 */

/** Latin-script diacritics used in Bosnian/Croatian/Serbian, plus common strays. */
const DIACRITIC_MAP: Record<string, string> = {
  č: 'c',
  ć: 'c',
  ž: 'z',
  š: 's',
  đ: 'd',
  Č: 'C',
  Ć: 'C',
  Ž: 'Z',
  Š: 'S',
  Đ: 'D',
};

/**
 * Strip BCS diacritics. `đ`/`Đ` need an explicit mapping because they are single
 * code points with no combining-mark decomposition, so NFD alone leaves them intact.
 */
export function foldDiacritics(input: string): string {
  return input
    .replace(/[čćžšđČĆŽŠĐ]/g, (ch) => DIACRITIC_MAP[ch] ?? ch)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .normalize('NFC');
}

/** Lowercase, fold diacritics, collapse whitespace. Use for search keys and comparisons. */
export function normalizeForSearch(input: string): string {
  return foldDiacritics(input).toLowerCase().replace(/\s+/g, ' ').trim();
}

/** URL-safe slug: folded, lowercased, non-alphanumerics collapsed to single hyphens. */
export function slugify(input: string): string {
  return foldDiacritics(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Query expansion for the single-variant UI. The site always says `patike`, but a
 * Croatian or Slovene speaker typing `tenisice` or `superge` must still get hits.
 * Expansion is silent — it never changes displayed copy.
 */
const QUERY_SYNONYMS: Record<string, readonly string[]> = {
  tenisice: ['patike'],
  superge: ['patike'],
  starke: ['patike'],
  obuca: ['patike', 'cipele'],
  sneakers: ['patike'],
  sneaker: ['patike'],
  kopacke: ['kopacke', 'patike'],
};

/**
 * Expand a query with synonym terms. Returns the original tokens plus any mapped
 * terms, de-duplicated and order-preserving.
 */
export function expandQuery(query: string): string[] {
  const tokens = normalizeForSearch(query).split(' ').filter(Boolean);
  const out: string[] = [];
  for (const token of tokens) {
    if (!out.includes(token)) out.push(token);
    for (const synonym of QUERY_SYNONYMS[token] ?? []) {
      if (!out.includes(synonym)) out.push(synonym);
    }
  }
  return out;
}

/**
 * Extract a manufacturer style code from a product title or SKU field.
 * Nike/adidas style codes look like `DV0787-100`, `CW2288 111`, `IG3796`.
 * Returns the normalized form (uppercase, single hyphen) or null.
 *
 * Note: BiH shops often expose their *own* house SKU (e.g. Buzz `BZA263G611-92`),
 * which is not a manufacturer code. Callers must treat a match as evidence, not proof.
 */
export function extractStyleCode(input: string): string | null {
  const match = input.toUpperCase().match(/\b([A-Z]{1,3}\d{4,6})[\s-]?(\d{2,3})?\b/);
  if (!match) return null;
  const [, head, tail] = match;
  return tail ? `${head}-${tail}` : (head ?? null);
}
