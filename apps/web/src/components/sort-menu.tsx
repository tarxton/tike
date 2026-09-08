import Link from 'next/link';
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
 * Result ordering, as a menu of links.
 *
 * This was a `<select>` that submitted its form on `change`, which worked on a desktop
 * pointer and failed on a phone. Two reasons, and each is enough on its own:
 *
 *   - A `<select>` on iOS opens a wheel picker that fires `change` while the wheel is
 *     still moving, so the page navigated to whichever option the wheel passed rather
 *     than the one the user stopped on.
 *   - The form's only submit control was `sr-only`, a 1×1 clipped button. That is a
 *     keyboard fallback, and a touch screen has no keyboard — so if the change handler
 *     did not fire, for any reason, there was no way at all to apply a sort.
 *
 * Links have neither problem: one tap, one navigation, no JavaScript, and the same
 * behaviour on every device. It also makes ordering work like every other filter on the
 * page, which are already links, so the back button and a shared URL both behave.
 */
export function SortMenu({
  sort,
  query,
  hrefFor,
}: {
  sort: SortKey | undefined;
  /** Relevance only exists as an option when there is something to be relevant to. */
  query?: string;
  /** Builds a URL with the order changed and every active filter intact. */
  hrefFor: (sort: SortKey | undefined) => string;
}) {
  // Without a query the unset default *is* "najnovije", so offering both an empty option
  // and the named one would list the same order twice. Relevance has no key of its own.
  const relevanceIsDefault = Boolean(query);
  const options: { key: SortKey | undefined; label: string }[] = [
    ...(relevanceIsDefault ? [{ key: undefined, label: t.sortRelevance }] : []),
    ...SORT_KEYS.map((key) => ({ key, label: LABELS[key] })),
  ];
  const current = sort ? LABELS[sort] : relevanceIsDefault ? t.sortRelevance : LABELS.najnovije;

  return (
    <details className="relative">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-900 hover:border-neutral-900 focus-visible:ring-2 focus-visible:ring-neutral-900/10 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        <span className="text-neutral-600">{t.sortBy}:</span>
        <span className="font-medium">{current}</span>
        <span aria-hidden="true" className="text-neutral-400">
          ▾
        </span>
      </summary>

      <div className="absolute left-0 z-20 mt-1 min-w-52 rounded-lg border border-neutral-200 bg-white p-1 shadow-lg">
        {options.map((o) => {
          const active = (o.key ?? undefined) === sort;
          return (
            <Link
              key={o.key ?? 'relevance'}
              href={hrefFor(o.key)}
              // Reordering the same results is not a reason to move the reader.
              scroll={false}
              aria-current={active ? 'true' : undefined}
              className={[
                'block rounded-md px-3 py-2 text-sm',
                'focus-visible:ring-2 focus-visible:ring-neutral-900/10 focus-visible:outline-none',
                active
                  ? 'bg-neutral-900 text-white'
                  : 'text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900',
              ].join(' ')}
            >
              {o.label}
            </Link>
          );
        })}
      </div>
    </details>
  );
}
