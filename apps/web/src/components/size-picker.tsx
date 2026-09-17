import { formatSize, t } from '@/lib/messages';
import { ADULT_MIN_SIZE } from '@/lib/sizes';
import { SizeGridScroll } from './size-grid-scroll';

const ALL_SIZES = 'velicine-sve';
const GRID = 'velicine-grid';

/** The numbers most people wear: whole adult sizes. Halves, thirds and children's wait. */
export function isBaseSize(size: number): boolean {
  return size >= ADULT_MIN_SIZE && Number.isInteger(size);
}

/**
 * The size picker, as a grid that never changes size.
 *
 * It used to be every size the catalogue stocks as one wrapping row of chips: 36, 36½, 36⅔,
 * 37, 37⅓, 37½… — forty-odd buttons, three rows on a desktop and ten on a phone before the
 * first result, and a "show children's sizes" link that made it longer still. Almost
 * everyone is looking for a whole number, and the thirds only exist because adidas sizes
 * that way.
 *
 * Now the whole adult sizes sit in an even grid — four columns on a phone, eight wider —
 * and "Prikaži sve brojeve" opens everything else inside the same box, which scrolls rather
 * than grows. The page below it does not move when you open it.
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
  const base = sizes.filter(isBaseSize);
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

      <div
        id={GRID}
        className="size-grid"
        style={
          {
            // Rows the base sizes need at each column count. The full view is held to the
            // same height, so opening it cannot push anything below it down the page.
            '--rows-narrow': Math.max(1, Math.ceil(base.length / 4)),
            '--rows-wide': Math.max(1, Math.ceil(base.length / 8)),
          } as React.CSSProperties
        }
      >
        {sizes.map((size) => (
          // Keyed on the checked state as well as the size, so clearing the filters really
          // unticks them. These are uncontrolled inputs — `defaultChecked` applies on mount
          // and never again — and a client navigation reuses the DOM node.
          <label
            key={`${size}:${selected.includes(size)}`}
            data-extra={isBaseSize(size) ? undefined : ''}
            data-base={isBaseSize(size) ? '' : undefined}
            className="cursor-pointer select-none"
          >
            <input
              type="checkbox"
              name="velicina"
              value={size}
              defaultChecked={selected.includes(size)}
              className="peer sr-only"
            />
            <span className="size-chip">{formatSize(size)}</span>
          </label>
        ))}
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

      <SizeGridScroll toggleId={ALL_SIZES} gridId={GRID} />
    </fieldset>
  );
}
