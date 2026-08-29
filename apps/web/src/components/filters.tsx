import Link from 'next/link';
import { formatSize, t } from '@/lib/messages';
import { applyFilters } from '@/lib/size';
import { ADULT_MIN_SIZE } from '@/lib/sizes';

/**
 * Search box and size picker, in a single form.
 *
 * They belong together because the question is usually "this model, in my size" —
 * two forms meant clicking a size discarded whatever had been typed, which silently
 * turned a model search into a bare size search.
 *
 * Sizes are checkboxes rather than submit buttons so ticking one composes the query
 * instead of running it. Nothing here needs client-side JavaScript.
 */
export function Filters({
  sizes,
  selected,
  showKids = false,
  kidsHref,
  query,
  brand,
  compact = false,
}: {
  sizes: number[];
  selected: number[];
  showKids?: boolean;
  kidsHref: string;
  query?: string;
  brand?: string;
  /** Results page: tighter spacing, since the grid is above the fold. */
  compact?: boolean;
}) {
  const visible = showKids ? sizes : sizes.filter((s) => s >= ADULT_MIN_SIZE);
  const kidsCount = sizes.filter((s) => s < ADULT_MIN_SIZE).length;

  return (
    <form action={applyFilters} className={compact ? 'space-y-3' : 'space-y-5'}>
      {showKids ? <input type="hidden" name="djecije" value="1" /> : null}
      {brand ? <input type="hidden" name="brend" value={brand} /> : null}

      <div className="flex w-full max-w-xl gap-2">
        <input
          type="search"
          name="q"
          defaultValue={query ?? ''}
          placeholder={t.searchPlaceholder}
          aria-label={t.search}
          className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus-visible:border-neutral-900 focus-visible:ring-2 focus-visible:ring-neutral-900/10 focus-visible:outline-none"
        />
        <button
          type="submit"
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          {t.search}
        </button>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-neutral-700">{t.chooseSize}</legend>

        <div className="flex flex-wrap gap-2">
          {visible.map((size) => {
            const isSelected = selected.includes(size);
            return (
              <label
                key={size}
                className={[
                  'cursor-pointer rounded-lg border px-3 py-2 text-sm font-medium transition select-none',
                  'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-offset-2',
                  isSelected
                    ? 'border-neutral-900 bg-neutral-900 text-white'
                    : 'border-neutral-300 bg-white text-neutral-900 hover:border-neutral-900',
                ].join(' ')}
              >
                <input
                  type="checkbox"
                  name="velicina"
                  value={size}
                  defaultChecked={isSelected}
                  className="sr-only"
                />
                {formatSize(size)}
              </label>
            );
          })}
        </div>

        <p className="mt-2 text-xs text-neutral-500">{t.multiSizeHint}</p>
      </fieldset>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="submit"
          className="rounded-lg border border-neutral-900 px-4 py-2 text-sm font-medium text-neutral-900 transition hover:bg-neutral-900 hover:text-white focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          {t.applyFilters}
        </button>

        {selected.length > 0 || query ? (
          <Link
            href="/patike"
            className="text-sm text-neutral-600 underline underline-offset-4 hover:text-neutral-900"
          >
            {t.clearFilters}
          </Link>
        ) : null}

        {kidsCount > 0 ? (
          <Link
            href={kidsHref}
            className="text-sm text-neutral-600 underline underline-offset-4 hover:text-neutral-900"
          >
            {showKids ? t.hideKids : `${t.showKids} (${kidsCount})`}
          </Link>
        ) : null}
      </div>
    </form>
  );
}
