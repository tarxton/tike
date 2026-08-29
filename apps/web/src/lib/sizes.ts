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
 * Apply one size button press to the current selection.
 *
 * An empty `toggle` means "all sizes" and clears the selection. It is handled as a
 * string rather than a number on purpose: `Number('')` is 0, not NaN, so a numeric
 * check treats the clear button as a request to select size 0 and the selection is
 * never cleared.
 */
export function nextSizes(current: number[], toggle: string): number[] {
  const trimmed = toggle.trim();
  if (trimmed === '') return [];

  const size = Number(trimmed);
  if (!Number.isFinite(size) || size < 15 || size > 52) return current;

  return current.includes(size)
    ? current.filter((s) => s !== size)
    : [...current, size].sort((a, b) => a - b);
}

/** "45,46" -> [45, 46]. Ignores junk, de-duplicates, sorts. */
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
