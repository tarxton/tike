import { SORT_KEYS, type SortKey } from '@tike/db';
import { t } from '@/lib/messages';

const LABELS: Record<SortKey, string> = {
  najnovije: t.sortNewest,
  najjeftinije: t.sortCheapest,
  najskuplje: t.sortDearest,
  snizenje: t.sortDiscount,
  abecedno: t.sortAlphabetical,
};

/**
 * Result ordering.
 *
 * A plain form with no JavaScript: choosing submits, the same way the size chips do.
 * Every active filter rides along as a hidden field, so changing the order does not
 * quietly clear the search someone has already typed.
 *
 * The unset option is not "none" — it is the contextual default, which is relevance while
 * a query is present and newest while browsing. Naming it honestly means someone who
 * picks a sort can get back to the ordering they started with.
 */
export function SortSelect({
  sort,
  query,
  sizes,
  brand,
  showKids,
}: {
  sort: SortKey | undefined;
  query?: string;
  sizes: number[];
  brand?: string;
  showKids: boolean;
}) {
  return (
    <form method="get" action="/patike" className="flex items-center gap-2">
      {query ? <input type="hidden" name="q" value={query} /> : null}
      {sizes.length > 0 ? <input type="hidden" name="velicina" value={sizes.join(',')} /> : null}
      {brand ? <input type="hidden" name="brend" value={brand} /> : null}
      {showKids ? <input type="hidden" name="djecije" value="1" /> : null}

      <label htmlFor="sort" className="text-sm text-neutral-600">
        {t.sortBy}
      </label>
      <select
        id="sort"
        name="sort"
        defaultValue={sort ?? ''}
        className="rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900 focus-visible:border-neutral-900 focus-visible:ring-2 focus-visible:ring-neutral-900/10 focus-visible:outline-none"
      >
        <option value="">{query ? t.sortRelevance : t.sortNewest}</option>
        {SORT_KEYS.map((key) => (
          <option key={key} value={key}>
            {LABELS[key]}
          </option>
        ))}
      </select>

      <button
        type="submit"
        className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 transition hover:border-neutral-900 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
      >
        OK
      </button>
    </form>
  );
}
