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
 * The picker's base grid: every whole size from 28 to 51.
 *
 * Twenty-four sizes, so three full rows of eight or four of six. 51 is the top because
 * nothing larger was stocked anywhere (52 to 55 had no offers on 2026-09-17), and the range
 * reaches down to 28 instead: a row of numbers no shop sells would be decoration.
 *
 * Fixed rather than taken from the catalogue so the grid keeps its shape when a thinly
 * stocked end sells out — 51 had two offers and 50 four. A base size nobody stocks is shown
 * greyed out and cannot be ticked, so the picker never offers a number that returns nothing.
 */
export const BASE_MIN_SIZE = 28;
export const BASE_MAX_SIZE = 51;

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
        .filter((n) => Number.isFinite(n) && n >= 15 && n <= BASE_MAX_SIZE + 1),
    ),
  ].sort((a, b) => a - b);
}
