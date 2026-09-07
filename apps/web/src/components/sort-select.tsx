'use client';

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
 * The only client component on the site, and it earns it: a select that needs a button
 * pressed afterwards is a select that gets left unpressed. Everything else here still
 * works without JavaScript — the form is a plain GET with a hidden submit, so keyboard
 * users and a broken bundle both still get an order change on Enter.
 *
 * Every active filter rides along as a hidden field, so reordering never quietly drops
 * the search someone typed.
 */
export function SortSelect({
  sort,
  query,
  sizes,
  brand,
  showKids,
  onSale,
  shops,
  genders,
}: {
  sort: SortKey | undefined;
  query?: string;
  sizes: number[];
  brand?: string;
  showKids: boolean;
  onSale: boolean;
  shops: string[];
  genders: string[];
}) {
  // Without a query the unset default *is* "najnovije", so offering both an empty option
  // and the named one listed the same order twice. Relevance has no key of its own, so it
  // stays the empty option — and only exists when there is something to be relevant to.
  const relevanceIsDefault = Boolean(query);

  return (
    <form method="get" action="/patike" className="flex items-center gap-2">
      {query ? <input type="hidden" name="q" value={query} /> : null}
      {sizes.length > 0 ? <input type="hidden" name="velicina" value={sizes.join(',')} /> : null}
      {brand ? <input type="hidden" name="brend" value={brand} /> : null}
      {showKids ? <input type="hidden" name="djecije" value="1" /> : null}
      {onSale ? <input type="hidden" name="akcija" value="1" /> : null}
      {shops.length > 0 ? <input type="hidden" name="prodavnica" value={shops.join(',')} /> : null}
      {genders.length > 0 ? <input type="hidden" name="pol" value={genders.join(',')} /> : null}

      <label htmlFor="sort" className="text-sm text-neutral-600">
        {t.sortBy}
      </label>
      <select
        id="sort"
        name="sort"
        defaultValue={sort ?? (relevanceIsDefault ? '' : 'najnovije')}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900 focus-visible:border-neutral-900 focus-visible:ring-2 focus-visible:ring-neutral-900/10 focus-visible:outline-none"
      >
        {relevanceIsDefault ? <option value="">{t.sortRelevance}</option> : null}
        {SORT_KEYS.map((key) => (
          <option key={key} value={key}>
            {LABELS[key]}
          </option>
        ))}
      </select>

      {/* Reachable by keyboard and used when JavaScript is not; never seen otherwise. */}
      <button type="submit" className="sr-only">
        {t.sortBy}
      </button>
    </form>
  );
}
