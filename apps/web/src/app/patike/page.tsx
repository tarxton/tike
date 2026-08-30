import type { Metadata } from 'next';
import Link from 'next/link';
import { availableBrands, availableSizes, searchOffers } from '@tike/db';
import { Filters } from '@/components/filters';
import { OfferCard } from '@/components/offer-card';
import { formatSize, pluralResults, showingSubset, t } from '@/lib/messages';
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
  const brand = first('brend');
  const query = first('q');
  const showKids = first('djecije') === '1';

  const [results, sizes, brands] = await Promise.all([
    searchOffers({ sizesEu: selected, brand, query, includeKids: showKids }),
    availableSizes(),
    availableBrands({ sizesEu: selected, query, includeKids: showKids }),
  ]);

  const hasFilters = selected.length > 0 || Boolean(brand) || Boolean(query);

  return (
    <main className="mx-auto max-w-6xl px-5 py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <Link href="/" className="text-xl font-semibold tracking-tight text-neutral-900">
          {t.siteName}
        </Link>
        <p className="text-sm text-neutral-600">
          <strong className="font-semibold text-neutral-900 tabular-nums">{results.total}</strong>{' '}
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
          kidsHref={buildHref({ sizes: selected, brand, query, kids: !showKids })}
          query={query}
          brand={brand}
          compact
        />
      </section>

      {query ? (
        <p className="mb-4 text-sm text-neutral-600">
          {t.resultsFor} <strong className="text-neutral-900">“{query}”</strong>{' '}
          <Link
            href={buildHref({ sizes: selected, brand, kids: showKids })}
            className="ml-1 underline underline-offset-4 hover:text-neutral-900"
          >
            {t.clearSearch}
          </Link>
        </p>
      ) : null}

      <nav aria-label={t.brand} className="mb-8 flex flex-wrap gap-2 text-sm">
        <FilterChip
          href={buildHref({ sizes: selected, brand: undefined, query, kids: showKids })}
          active={!brand}
        >
          {t.allBrands}
        </FilterChip>
        {brands.slice(0, 12).map((b) => (
          <FilterChip
            key={b.brand}
            href={buildHref({ sizes: selected, brand: b.brand, query, kids: showKids })}
            active={brand?.toLowerCase() === b.brand.toLowerCase()}
          >
            {b.brand} <span className="text-neutral-400 tabular-nums">{b.count}</span>
          </FilterChip>
        ))}
      </nav>

      {results.items.length === 0 ? (
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

      {results.total > results.items.length ? (
        <p className="mt-6 text-center text-sm text-neutral-600">
          {showingSubset(results.items.length, results.total)}
        </p>
      ) : null}

      <footer className="mt-12 border-t border-neutral-200 pt-6 text-xs text-neutral-500">
        <p>{t.priceNote}</p>
        <p className="mt-1">{t.footerAbout}</p>
      </footer>
    </main>
  );
}

function buildHref({
  sizes,
  brand,
  query,
  kids,
}: {
  sizes: number[];
  brand?: string;
  query?: string;
  kids?: boolean;
}): string {
  const sp = new URLSearchParams();
  if (sizes.length > 0) sp.set('velicina', sizes.join(','));
  if (brand) sp.set('brend', brand);
  if (query) sp.set('q', query);
  if (kids) sp.set('djecije', '1');
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
