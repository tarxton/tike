import Link from 'next/link';
import { ModelSearch } from './model-search';
import { SizePicker } from './size-picker';
import { t } from '@/lib/messages';
import { applyFilters } from '@/lib/size';

/**
 * Search box and size picker, in a single form.
 *
 * They belong together because the question is usually "this model, in my size" —
 * two forms meant clicking a size discarded whatever had been typed, which silently
 * turned a model search into a bare size search.
 *
 * Sizes are checkboxes rather than submit buttons so ticking one composes the query
 * instead of running it. Nothing here needs client-side JavaScript; see SizePicker.
 *
 * One submit button, and it sits after the sizes rather than beside the search box.
 * A button glued to the input reads as "search this text" and hides the fact that the
 * ticked sizes travel with it; placing the only button last makes it unambiguous that
 * it submits everything above.
 */
export function Filters({
  sizes,
  selected,
  showKids = false,
  query,
  model,
  applyModelOnPick = false,
  brands = [],
  compact = false,
  returnTo = '/patike',
  keep,
}: {
  sizes: number[];
  selected: number[];
  /** A URL that asked for children's shoes opens the picker on every size. */
  showKids?: boolean;
  query?: string;
  /** The model the results are filtered to, so the box can say so and the form keeps it. */
  model?: { key: string; label: string };
  /** See ModelSearch: the results page applies a picked model at once, the home page waits. */
  applyModelOnPick?: boolean;
  brands?: string[];
  /** Results page: tighter spacing, since the grid is above the fold. */
  compact?: boolean;
  /** Where "clear" returns to. On the home page, clearing must not run a search. */
  returnTo?: string;
  /**
   * The filters in force that the form has no field for, so a search keeps them.
   *
   * The form sends sizes, text and model; order, gender, shop and sale live in the URL.
   * Rebuilt from the form alone, "Pretraži" reset the sort to its default and dropped the
   * rest, so re-searching with another size meant choosing them all again.
   */
  keep?: { sort?: string; onSale?: boolean; shops?: string[]; genders?: string[] };
}) {
  return (
    <form action={applyFilters} className={compact ? 'space-y-3' : 'space-y-5'}>
      {showKids ? <input type="hidden" name="djecije" value="1" /> : null}
      {brands.length > 0 ? <input type="hidden" name="brend" value={brands.join(',')} /> : null}
      {keep?.sort ? <input type="hidden" name="sort" value={keep.sort} /> : null}
      {keep?.onSale ? <input type="hidden" name="akcija" value="1" /> : null}
      {keep?.shops && keep.shops.length > 0 ? (
        <input type="hidden" name="prodavnica" value={keep.shops.join(',')} />
      ) : null}
      {keep?.genders && keep.genders.length > 0 ? (
        <input type="hidden" name="pol" value={keep.genders.join(',')} />
      ) : null}

      {/*
       * Keyed on what it was built from: its text is state, and a client navigation to
       * different results would otherwise keep the previous search in the box — and, worse,
       * the previous model in the form.
       */}
      <ModelSearch
        key={`${query ?? ''}|${model?.key ?? ''}`}
        defaultValue={query}
        model={model}
        applyOnPick={applyModelOnPick}
      />

      <SizePicker sizes={sizes} selected={selected} openAll={showKids} />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="submit"
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          {t.search}
        </button>

        {selected.length > 0 || query || model ? (
          // A plain link now. It had to be a server action while a cookie held the
          // sizes, because clearing only the URL left the cookie to put them straight
          // back and the button looked broken. With no cookie, the URL is the state.
          <Link
            href={returnTo === '/' ? '/' : '/patike'}
            className="text-sm text-neutral-600 underline underline-offset-4 hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            {t.clearFilters}
          </Link>
        ) : null}
      </div>
    </form>
  );
}
