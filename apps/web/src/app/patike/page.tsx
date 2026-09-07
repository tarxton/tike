import type { Metadata } from 'next';
import Link from 'next/link';
import { availableBrands, availableShops, availableSizes, isSortKey, searchOffers } from '@tike/db';
import { Filters } from '@/components/filters';
import { OfferCard } from '@/components/offer-card';
import { Pager } from '@/components/pager';
import { SortMenu } from '@/components/sort-menu';
import { FilterBar, GENDERS } from '@/components/filter-bar';
import { formatCount, formatSize, pluralResults, showingRange, t } from '@/lib/messages';
import { getSizes } from '@/lib/size';
import { parseSizes } from '@/lib/sizes';

export const dynamic = 'force-dynamic';

/**
 * Filtered result pages are not indexed. SEO weight belongs on curated landing pages
 * (Phase 3), not on every filter combination — the same approach everysize takes, where
 * /search/ is disallowed outright.
 */
export const metadata: Metadata = {
  title: `${t.siteName} — ${t.tagline}`,
  robots: { index: false, follow: true },
};

export default async function Results({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const first = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  // The URL wins over the cookie, so a shared link shows what the sender saw.
  const urlSizes = parseSizes(first('velicina'));
  const selected = urlSizes.length > 0 ? urlSizes : await getSizes();
  const brands = parseList(first('brend'));
  const query = first('q');
  const showKids = first('djecije') === '1';
  const page = parsePage(first('strana'));
  const sortParam = first('sort');
  const sort = isSortKey(sortParam) ? sortParam : undefined;
  const onSale = first('akcija') === '1';
  const shops = parseList(first('prodavnica'));
  // Unknown values are dropped rather than passed to the query, so a hand-edited URL
  // cannot turn into an empty result set that looks like a bug.
  const genders = parseList(first('pol')).filter((g) =>
    (GENDERS as readonly { value: string }[]).some((x) => x.value === g),
  );

  const [results, sizes, brandFacets, allShops] = await Promise.all([
    searchOffers({
      sizesEu: selected,
      brands,
      query,
      includeKids: showKids,
      onSale,
      shops,
      genders,
      sort,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    availableSizes(),
    availableBrands({ sizesEu: selected, query, includeKids: showKids, onSale, shops, genders }),
    availableShops(),
  ]);

  const selectedBrands = new Set(brands.map((b) => b.toLowerCase()));
  // Every brand chip worth showing: the top of the facet list, plus any brand the user
  // has already picked. A selected chip that falls outside the cut — or whose count drops
  // to zero under the other filters — must still render, or the filter cannot be switched
  // off except by editing the URL.
  const brandChips = [
    ...brandFacets.slice(0, 12),
    ...brandFacets.slice(12).filter((b) => selectedBrands.has(b.brand.toLowerCase())),
    ...brands
      .filter((b) => !brandFacets.some((f) => f.brand.toLowerCase() === b.toLowerCase()))
      .map((brand) => ({ brand, count: 0 })),
  ];
  const toggleBrand = (value: string) => {
    const lower = value.toLowerCase();
    return selectedBrands.has(lower)
      ? brands.filter((b) => b.toLowerCase() !== lower)
      : [...brands, value];
  };

  const hasFilters =
    selected.length > 0 ||
    brands.length > 0 ||
    Boolean(query) ||
    onSale ||
    shops.length > 0 ||
    genders.length > 0;
  const totalPages = Math.max(1, Math.ceil(results.total / PAGE_SIZE));
  const firstOnPage = (page - 1) * PAGE_SIZE + 1;
  const lastOnPage = firstOnPage + results.items.length - 1;
  // A page past the end returns no rows, and with no rows there is no window to count
  // over — so `total` reads 0 and an over-shot page is indistinguishable from a search
  // that genuinely matched nothing. Tell them apart by the page number.
  const pastTheEnd = results.items.length === 0 && page > 1;

  return (
    <main className="mx-auto max-w-6xl px-5 py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <Link href="/" className="text-xl font-semibold tracking-tight text-neutral-900">
          {t.siteName}
        </Link>
        <p className="text-sm text-neutral-600">
          <strong className="font-semibold text-neutral-900 tabular-nums">
            {formatCount(results.total)}
          </strong>{' '}
          {pluralResults(results.total)}
          {selected.length > 0 ? (
            <>
              {' · '}
              {t.chooseSizeShort}{' '}
              <strong className="text-neutral-900">{selected.map(formatSize).join(', ')}</strong>
            </>
          ) : null}
        </p>
      </header>

      <section aria-label={t.chooseSize} className="mb-6">
        <Filters
          sizes={sizes}
          selected={selected}
          showKids={showKids}
          kidsHref={buildHref({
            sizes: selected,
            brands,
            query,
            kids: !showKids,
            sort,
            onSale,
            shops,
            genders,
          })}
          query={query}
          brands={brands}
          compact
        />
      </section>

      {query ? (
        <p className="mb-4 text-sm text-neutral-600">
          {t.resultsFor} <strong className="text-neutral-900">“{query}”</strong>{' '}
          <Link
            href={buildHref({
              sizes: selected,
              brands,
              kids: showKids,
              sort,
              onSale,
              shops,
              genders,
            })}
            className="ml-1 underline underline-offset-4 hover:text-neutral-900"
          >
            {t.clearSearch}
          </Link>
        </p>
      ) : null}

      {results.total > 0 ? (
        // Ruled off from the filter block above it: the search box and the size chips
        // compose a query, this changes how the answer is arranged. Different jobs.
        <div className="mt-5 mb-6 flex justify-start border-t border-neutral-200 pt-4">
          <SortMenu
            sort={sort}
            query={query}
            hrefFor={(next) =>
              buildHref({
                sizes: selected,
                brands,
                query,
                kids: showKids,
                sort: next,
                onSale,
                shops,
                genders,
              })
            }
          />
        </div>
      ) : null}

      <FilterBar
        onSale={onSale}
        shops={shops}
        genders={genders}
        allShops={allShops}
        hrefFor={(change) =>
          buildHref({
            sizes: selected,
            brands,
            query,
            kids: showKids,
            sort,
            onSale: change.onSale ?? onSale,
            shops: change.shops ?? shops,
            genders: change.genders ?? genders,
          })
        }
      />

      <nav aria-label={t.brand} className="mb-8 flex flex-wrap gap-2 text-sm">
        <FilterChip
          href={buildHref({
            sizes: selected,
            brands: [],
            query,
            kids: showKids,
            sort,
            onSale,
            shops,
            genders,
          })}
          active={brands.length === 0}
        >
          {t.allBrands}
        </FilterChip>
        {brandChips.map((b) => (
          <FilterChip
            key={b.brand}
            href={buildHref({
              sizes: selected,
              brands: toggleBrand(b.brand),
              query,
              kids: showKids,
              sort,
              onSale,
              shops,
              genders,
            })}
            active={selectedBrands.has(b.brand.toLowerCase())}
          >
            {b.brand} <span className="text-neutral-400 tabular-nums">{b.count}</span>
          </FilterChip>
        ))}
      </nav>

      {pastTheEnd ? (
        <div className="rounded-xl border border-dashed border-neutral-300 px-6 py-16 text-center">
          <p className="font-medium text-neutral-900">{t.emptyPage}</p>
          <Link
            href={buildHref({
              sizes: selected,
              brands,
              query,
              kids: showKids,
              sort,
              onSale,
              shops,
              genders,
            })}
            className="mt-4 inline-block text-sm underline underline-offset-4 hover:text-neutral-900"
          >
            {t.backToFirstPage}
          </Link>
        </div>
      ) : results.items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 px-6 py-16 text-center">
          <p className="font-medium text-neutral-900">{t.noResults}</p>
          <p className="mt-1 text-sm text-neutral-600">{t.noResultsHint}</p>
          {hasFilters ? (
            <Link
              href="/patike"
              className="mt-4 inline-block text-sm underline underline-offset-4 hover:text-neutral-900"
            >
              {t.clearFilters}
            </Link>
          ) : null}
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {results.items.map((offer) => (
            <li key={offer.offerId}>
              <OfferCard offer={offer} sizes={selected} />
            </li>
          ))}
        </ul>
      )}

      {results.items.length > 0 && totalPages > 1 ? (
        <>
          <p className="mt-6 text-center text-sm text-neutral-600">
            {showingRange(firstOnPage, lastOnPage, results.total)}
          </p>
          <Pager
            page={page}
            totalPages={totalPages}
            hrefFor={(p) =>
              buildHref({
                sizes: selected,
                brands,
                query,
                kids: showKids,
                sort,
                onSale,
                shops,
                genders,
                page: p,
              })
            }
          />
        </>
      ) : null}

      <footer className="mt-12 border-t border-neutral-200 pt-6 text-xs text-neutral-500">
        <p>{t.priceNote}</p>
        <p className="mt-1">{t.footerAbout}</p>
      </footer>
    </main>
  );
}

/** Results per page. Also the page size the pager and the range notice count in. */
const PAGE_SIZE = 48;

/** `?strana=3`. Anything that is not a whole page number is page one. */
/** `?prodavnica=buzz,officeshoes` — empty entries dropped. */
function parseList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function parsePage(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

function buildHref({
  sizes,
  brands,
  query,
  kids,
  page,
  sort,
  onSale,
  shops,
  genders,
}: {
  sizes: number[];
  brands?: string[];
  query?: string;
  kids?: boolean;
  page?: number;
  sort?: string;
  onSale?: boolean;
  shops?: string[];
  genders?: string[];
}): string {
  const sp = new URLSearchParams();
  if (sizes.length > 0) sp.set('velicina', sizes.join(','));
  if (brands && brands.length > 0) sp.set('brend', brands.join(','));
  if (query) sp.set('q', query);
  if (kids) sp.set('djecije', '1');
  // Page one is the bare URL: a filter change should never land on page 7 of nothing.
  if (page && page > 1) sp.set('strana', String(page));
  if (sort) sp.set('sort', sort);
  if (onSale) sp.set('akcija', '1');
  if (shops && shops.length > 0) sp.set('prodavnica', shops.join(','));
  if (genders && genders.length > 0) sp.set('pol', genders.join(','));
  const qs = sp.toString();
  return qs ? `/patike?${qs}` : '/patike';
}

function FilterChip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={[
        'rounded-full border px-3 py-1 transition',
        'focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
        active
          ? 'border-neutral-900 bg-neutral-900 text-white'
          : 'border-neutral-300 bg-white text-neutral-700 hover:border-neutral-900',
      ].join(' ')}
    >
      {children}
    </Link>
  );
}
