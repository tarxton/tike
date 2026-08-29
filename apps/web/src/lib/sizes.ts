/**
 * Pure size helpers, importable from anywhere.
 *
 * Kept out of `size.ts` because a `'use server'` module may only export async
 * functions — constants and sync helpers there are a build error.
 */

/**
 * Sizes below this are children's. Adults are the default audience, so the picker
 * shows adult numbers first and hides the rest behind a toggle — otherwise the first
 * thing on the page is a wall of 58 buttons starting at toddler size 21.
 */
export const ADULT_MIN_SIZE = 36;

/**
 * "45,46" -> [45, 46]. Ignores junk, de-duplicates, sorts.
 *
 * Note the guard against 0: an earlier toggle-button design relied on `Number('')`
 * being NaN. It is 0, so the "all sizes" button selected size 0 instead of clearing.
 * Sizes now arrive as checkboxes, but the range check stays as a backstop.
 */
export function parseSizes(raw: string | null | undefined): number[] {
  if (!raw) return [];
  return [
    ...new Set(
      raw
        .split(',')
        .map((part) => Number(part.trim()))
        .filter((n) => Number.isFinite(n) && n >= 15 && n <= 52),
    ),
  ].sort((a, b) => a - b);
}
