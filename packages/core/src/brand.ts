import { normalizeForSearch } from './text';

/**
 * One brand under two names.
 *
 * Shops spell brands their own way, and case is already folded everywhere brands are
 * compared, so "NIKE" and "Nike" are one brand without any help. What folding cannot join
 * is two different names for the same company: Juventa writes "361" and Đak "361 DEGREES",
 * so until this existed the brand filter offered them as two brands and matching, which
 * only compares listings within a brand, never tried to pair their shoes.
 *
 * A list rather than a rule, because every entry is a claim that two names are one
 * company, and that is a fact to check, not a pattern to infer. Distinct lines of one
 * house stay distinct: BOSS and BOSS Orange, Calvin Klein and Calvin Klein Jeans, Polo
 * and Lauren Ralph Lauren are sold, labelled and priced as separate brands.
 *
 * Keyed on the folded name; the value is the name tike shows.
 */
const ALIASES: Record<string, string> = {
  '361': '361 Degrees',
  '361°': '361 Degrees',
  '361 degrees': '361 Degrees',
};

export function canonicalBrand(brand: string | null): string | null {
  if (!brand) return brand;
  return ALIASES[normalizeForSearch(brand)] ?? brand;
}

/**
 * Every name a brand is known by, longest first, for taking it off the front of a title.
 *
 * A title keeps the shop's own spelling ("361 BIG3 6.0" at Juventa) while the brand is
 * stored under its canonical name, so stripping only the canonical one would leave the
 * shop's spelling glued to the model.
 */
export function brandSpellings(brand: string | null): string[] {
  if (!brand) return [];
  const canonical = canonicalBrand(brand) ?? brand;
  const names = new Set([brand, canonical]);
  for (const [alias, target] of Object.entries(ALIASES)) {
    if (target === canonical) names.add(alias);
  }
  return [...names].sort((a, b) => b.length - a.length);
}
