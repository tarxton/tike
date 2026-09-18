import { sizeMatch } from './sizes';

/**
 * Which size chips a card shows, when it cannot show them all.
 *
 * A card has room for about ten numbers and a shoe can stock twenty, so the rest collapse
 * into "+N". Taking simply the first ten is wrong in the one case the site exists for:
 * filter to 46, and a shoe stocking 36 to 48 shows 36 through 41 and a "+9" — no sign
 * anywhere on the card that it has your size, on a page whose whole promise is that
 * everything on it does.
 *
 * Measured against the live catalogue: 0.5% of cards at EU 38, 2.7% at 44, 4.2% at 46.
 * It gets worse the larger your feet, which is exactly backwards — large sizes are the
 * hardest to find and the reason this kind of site exists at all.
 *
 * So the selected sizes are kept whatever else is dropped, and the rest of the room goes
 * to the smallest remaining sizes. Everything is then displayed in ascending order: a gap
 * between 41 and 46 with 46 highlighted reads as "and also your size", while sorting the
 * selected ones to the front would make the row look mis-sorted.
 *
 * Same idea as the brand chips, where a selected brand sorts ahead of the two-row cut so
 * a picked filter is never the one clipped out of sight.
 */
export function chipsToShow(available: number[], selected: number[], room: number): number[] {
  if (available.length <= room) return available;

  // Near sizes too: a card shown because it stocks 44⅔ for someone who picked 44 has to
  // show the 44⅔, or it is on the page for no visible reason.
  const keep = available.filter((s) => sizeMatch(s, selected) !== null).slice(0, room);
  const rest = available.filter((s) => !keep.includes(s)).slice(0, room - keep.length);
  return [...keep, ...rest].sort((a, b) => a - b);
}

/**
 * A size chip's colours, by how that size relates to what the visitor picked.
 *
 * Filled for the size itself, outlined for a half or a third of a whole size they picked —
 * on offer and shown because of their pick, but not the number they asked for, and it must
 * not look as though it were. Plain for everything else.
 */
export function sizeChipClass(size: number, selected: number[]): string {
  const match = sizeMatch(size, selected);
  if (match === 'exact') return 'bg-neutral-900 text-white';
  if (match === 'near') return 'bg-white text-neutral-900 ring-1 ring-neutral-900 ring-inset';
  return 'bg-neutral-100 text-neutral-700';
}
