import { t } from '@/lib/messages';

/**
 * Model search.
 *
 * Plenty of people arrive with a model in mind and want to know which shop has it in
 * their size — so the query composes with the size filter rather than replacing it.
 * A plain GET form keeps the URL shareable and needs no client JavaScript.
 */
export function SearchBar({
  defaultValue,
  sizes,
  showKids,
}: {
  defaultValue?: string;
  sizes: number[];
  showKids?: boolean;
}) {
  return (
    <form action="/patike" method="get" role="search" className="flex w-full max-w-md gap-2">
      {/* Preserve the active filters when submitting a new query. */}
      {sizes.length > 0 ? <input type="hidden" name="velicina" value={sizes.join(',')} /> : null}
      {showKids ? <input type="hidden" name="djecije" value="1" /> : null}

      <input
        type="search"
        name="q"
        defaultValue={defaultValue ?? ''}
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
    </form>
  );
}
