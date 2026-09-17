import { formatSize, t } from '@/lib/messages';
import { BASE_MAX_SIZE, BASE_MIN_SIZE } from '@/lib/sizes';
import { SizeGridScroll } from './size-grid-scroll';

const ALL_SIZES = 'velicine-sve';
const GRID = 'velicine-grid';
const THUMB = 'velicine-thumb';

/** The base grid: whole sizes 28 to 51. Halves, thirds and the rest wait behind the toggle. */
export function isBaseSize(size: number): boolean {
  return Number.isInteger(size) && size >= BASE_MIN_SIZE && size <= BASE_MAX_SIZE;
}

const BASE_SIZES = Array.from(
  { length: BASE_MAX_SIZE - BASE_MIN_SIZE + 1 },
  (_, i) => BASE_MIN_SIZE + i,
);

/**
 * The size picker, as a grid that never changes size.
 *
 * It used to be every size the catalogue stocks as one wrapping row of chips: 36, 36½, 36⅔,
 * 37, 37⅓, 37½… — forty-odd buttons, three rows on a desktop and ten on a phone before the
 * first result, and a "show children's sizes" link that made it longer still. Almost
 * everyone is looking for a whole number, and the thirds only exist because adidas sizes
 * that way.
 *
 * Now whole sizes 28 to 51 sit in an even grid — four rows of six on a phone, three rows of
 * eight wider — and "Prikaži sve brojeve" opens everything else inside the same box, which
 * scrolls rather than grows. The page below it does not move when you open it. The range
 * is fixed, so the grid keeps its shape; a size nobody stocks is shown greyed out and cannot
 * be ticked.
 *
 * No JavaScript needed for any of that. The toggle is a checkbox the grid is a sibling of,
 * the same pattern as the chips themselves and the brand expander: every chip is always in
 * the form, the extra ones are only hidden, so a size ticked in the full view is still
 * submitted after the view is closed. With JavaScript, opening the full view scrolls to the
 * adult sizes, which would otherwise sit below forty children's sizes.
 */
export function SizePicker({
  sizes,
  selected,
  openAll = false,
}: {
  sizes: number[];
  selected: number[];
  /** Start in the full view — for a URL that already asked for children's sizes. */
  openAll?: boolean;
}) {
  const stocked = new Set(sizes);
  // Every base size, stocked or not, plus whatever else the catalogue has, in one ascending
  // list — the full view reads in order and the base view is that list with gaps hidden.
  const shown = [...new Set([...BASE_SIZES, ...sizes])].sort((a, b) => a - b);
  // A half or a third that is already ticked must be on screen, or the only sign of it is
  // the results quietly narrowing to a size the visitor cannot see selected.
  const startOpen = openAll || selected.some((s) => !isBaseSize(s));

  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-neutral-700">{t.chooseSize}</legend>

      {/*
       * Keyed on its default, for the same reason as the chips: an uncontrolled input keeps
       * its state across a client navigation, so arriving at a URL with a third selected
       * would otherwise keep whatever view the previous page was in.
       */}
      <input
        key={`all:${startOpen}`}
        type="checkbox"
        id={ALL_SIZES}
        defaultChecked={startOpen}
        className="peer sr-only"
      />

      {/*
       * Wrapped so the scrollbar can sit beside the grid rather than inside it: a track
       * drawn as a grid child would take a cell, and one drawn over the chips would cover
       * the last column's numbers.
       */}
      <div className="size-grid-wrap">
        <div
          id={GRID}
          className="size-grid"
          style={
            {
              // Rows the base sizes need at each column count. The full view is held to the
              // same height, so opening it cannot push anything below it down the page.
              '--rows-narrow': Math.ceil(BASE_SIZES.length / 6),
              '--rows-wide': Math.ceil(BASE_SIZES.length / 8),
            } as React.CSSProperties
          }
        >
          {shown.map((size) => {
            const available = stocked.has(size);
            return (
              // Keyed on the checked state as well as the size, so clearing the filters really
              // unticks them. These are uncontrolled inputs — `defaultChecked` applies on mount
              // and never again — and a client navigation reuses the DOM node.
              <label
                key={`${size}:${selected.includes(size)}:${available}`}
                data-extra={isBaseSize(size) ? undefined : ''}
                data-base={isBaseSize(size) ? '' : undefined}
                title={available ? undefined : t.sizeUnavailable}
                className={available ? 'cursor-pointer select-none' : 'cursor-default select-none'}
              >
                <input
                  type="checkbox"
                  name="velicina"
                  value={size}
                  defaultChecked={selected.includes(size)}
                  // Disabled rather than left out: the grid keeps its shape, and a disabled
                  // box is neither focusable nor submitted, so it cannot produce an empty page.
                  disabled={!available}
                  className="peer sr-only"
                />
                <span className="size-chip">{formatSize(size)}</span>
              </label>
            );
          })}
        </div>
        {/*
         * Ours rather than the browser's, because iOS draws none until a scroll is under
         * way and ignores `::-webkit-scrollbar`, which made the box look like it simply cut
         * the list off. Hidden from screen readers: it says nothing the list does not.
         */}
        <div className="size-scrollbar" aria-hidden="true">
          <div id={THUMB} className="size-scrollbar-thumb" />
        </div>
      </div>

      <p className="mt-2 text-xs text-neutral-500">{t.multiSizeHint}</p>
      {/*
       * Two labels rather than one with swapping text: `peer-checked:` compiles to a sibling
       * selector, so only siblings of the checkbox can react to it — the same reason the
       * brand expander has two. 44px tall, so they are a real target under a thumb.
       */}
      <label
        htmlFor={ALL_SIZES}
        className="mt-1 inline-flex min-h-11 cursor-pointer items-center text-sm text-neutral-600 underline underline-offset-4 peer-checked:hidden hover:text-neutral-900"
      >
        {t.showAllSizes}
      </label>
      <label
        htmlFor={ALL_SIZES}
        className="mt-1 hidden min-h-11 cursor-pointer items-center text-sm text-neutral-600 underline underline-offset-4 peer-checked:inline-flex hover:text-neutral-900"
      >
        {t.showBaseSizes}
      </label>

      <SizeGridScroll toggleId={ALL_SIZES} gridId={GRID} thumbId={THUMB} />
    </fieldset>
  );
}
