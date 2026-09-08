import type { Metadata } from 'next';
import Link from 'next/link';
import { after } from 'next/server';
import {
  availableBrands,
  logSearchMiss,
  availableShops,
  availableSizes,
  isSortKey,
  modelByKey,
  searchOffers,
} from '@tike/db';
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
  const modelKey = first('model');
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

  // Defined once so the fuzzy retry below cannot drift from the search it is retrying.
  const searchArgs = {
    sizesEu: selected,
    brands,
    modelKey,
    query,
    includeKids: showKids,
    onSale,
    shops,
    genders,
    sort,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  };

  const [results, sizes, brandFacets, allShops, activeModel] = await Promise.all([
    searchOffers(searchArgs),
    availableSizes(),
    availableBrands({
      sizesEu: selected,
      modelKey,
      query,
      includeKids: showKids,
      onSale,
      shops,
      genders,
    }),
    availableShops(),
    modelByKey(modelKey),
  ]);

  /*
   * Nothing found: say so where it can be counted, then try again more loosely.
   *
   * The log runs in `after`, so a shopper who found nothing is not also made to wait on
   * a write they will never see. Only page one is recorded — running off the end of a
   * result set is not a miss, it is a pager.
   */
  const missed = results.total === 0 && page === 1 && Boolean(query);

  // A second attempt at trigram distance, so "cortz" reaches Cortez. Deliberately not
  // folded into the first query: a search that works must not be diluted by near-misses,
  // and this costs a round trip only on a page that was going to be empty anyway.
  const fuzzy = missed ? await searchOffers({ ...searchArgs, fuzzy: true }) : null;
  const shown = fuzzy && fuzzy.total > 0 ? fuzzy : results;
  const didYouMean = Boolean(fuzzy && fuzzy.total > 0);

  if (missed) {
    // Logged after the retry so the row can say which kind of miss it was. "cortz",
    // rescued by trigram distance, is a spelling to fold into matching; "zxcvbn", which
    // nothing rescued, is either a shoe the catalogue lacks or a word it cannot parse.
    // Recording both as simply "no results" would blur the two signals into one number.
    after(() =>
      logSearchMiss({
        query: query!,
        sizesEu: selected,
        filters: {
          brands,
          genders,
          shops,
          onSale,
          model: modelKey,
          kids: showKids,
          rescued: didYouMean,
        },
      }),
    );
  }

  const selectedBrands = new Set(brands.map((b) => b.toLowerCase()));
  // Every brand in the catalogue, not a top-twelve cut. The cut hid 36 of 48 brands —
  // Salomon, Vans, Hoka, Timberland among them — so 17% of the catalogue was reachable
  // by search but not by the filter that claimed to list the brands.
  //
  // A selected brand whose count drops to zero under the other filters disappears from
  // the facet list entirely, so it is appended here or the filter could not be switched
  // off except by editing the URL.
  //
  // Selected brands then lead, so a picked chip is never the one clipped by the two-row
  // collapse — the same trap the old cut had, in a new shape.
  const brandChips = [
    ...brandFacets,
    ...brands
      .filter((b) => !brandFacets.some((f) => f.brand.toLowerCase() === b.toLowerCase()))
      .map((brand) => ({ brand, count: 0 })),
  ].sort((a, b) => {
    const aOn = selectedBrands.has(a.brand.toLowerCase()) ? 0 : 1;
    const bOn = selectedBrands.has(b.brand.toLowerCase()) ? 0 : 1;
    return aOn - bOn;
  });
  const toggleBrand = (value: string) => {
    const lower = value.toLowerCase();
    return selectedBrands.has(lower)
      ? brands.filter((b) => b.toLowerCase() !== lower)
      : [...brands, value];
  };

  const hasFilters =
    selected.length > 0 ||
    brands.length > 0 ||
    Boolean(modelKey) ||
    Boolean(query) ||
    onSale ||
    shops.length > 0 ||
    genders.length > 0;
  const totalPages = Math.max(1, Math.ceil(shown.total / PAGE_SIZE));
  const firstOnPage = (page - 1) * PAGE_SIZE + 1;
  const lastOnPage = firstOnPage + shown.items.length - 1;
  // A page past the end returns no rows, and with no rows there is no window to count
  // over — so `total` reads 0 and an over-shot page is indistinguishable from a search
  // that genuinely matched nothing. Tell them apart by the page number.
  const pastTheEnd = shown.items.length === 0 && page > 1;

  return (
    <main className="mx-auto max-w-6xl px-5 py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <Link href="/" className="text-xl font-semibold tracking-tight text-neutral-900">
          {t.siteName}
        </Link>
        <p className="text-sm text-neutral-600">
          <strong className="font-semibold text-neutral-900 tabular-nums">
            {formatCount(shown.total)}
          </strong>{' '}
          {pluralResults(shown.total)}
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
            model: modelKey,
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

      {/*
       * A picked model is a filter like any other, so it says what it is and offers a
       * way out. Without this the grid silently holds one model and the only escape is
       * editing the URL — the same trap the brand chips had.
       */}
      {activeModel ? (
        <p className="mb-4 text-sm text-neutral-600">
          {t.model}{' '}
          <strong className="text-neutral-900">
            {[activeModel.brand, activeModel.model].filter(Boolean).join(' ')}
          </strong>{' '}
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
            scroll={false}
            className="ml-1 underline underline-offset-4 hover:text-neutral-900"
          >
            {t.clearModel}
          </Link>
        </p>
      ) : null}

      {/*
       * Said plainly when the results are approximate. Quietly substituting near-misses
       * for what was asked would leave someone wondering why a search for one shoe
       * returned another.
       */}
      {didYouMean ? (
        <p className="mb-4 text-sm text-neutral-600">
          {t.noExactResults} <strong className="text-neutral-900">“{query}”</strong>.{' '}
          {t.showingSimilar}
        </p>
      ) : null}

      {query && !didYouMean ? (
        <p className="mb-4 text-sm text-neutral-600">
          {t.resultsFor} <strong className="text-neutral-900">“{query}”</strong>{' '}
          <Link
            href={buildHref({
              sizes: selected,
              brands,
              model: modelKey,
              kids: showKids,
              sort,
              onSale,
              shops,
              genders,
            })}
            scroll={false}
            className="ml-1 underline underline-offset-4 hover:text-neutral-900"
          >
            {t.clearSearch}
          </Link>
        </p>
      ) : null}

      {shown.total > 0 ? (
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
                model: modelKey,
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
            model: modelKey,
            query,
            kids: showKids,
            sort,
            onSale: change.onSale ?? onSale,
            shops: change.shops ?? shops,
            genders: change.genders ?? genders,
          })
        }
      />

      {/*
       * Brands: two rows everywhere, with an expander for the rest.
       *
       * All 48 laid flat came to 562px on a 375px screen — sixteen rows of chips before
       * a single shoe — and five rows at 1280px.
       *
       * A horizontal swipe strip was tried on phones first and pulled: nothing about a
       * row of chips announces that it scrolls, and the overlay scrollbar sat on top of
       * the chips it was meant to describe. A visible "Svi brendovi" line is a control
       * people can see, and using one pattern at every width means the phone is not the
       * variant that gets tested last.
       *
       * The toggle is a checkbox rather than <details> because <details> hides every
       * child when closed, and the point here is that two rows stay visible. Same
       * peer-checked pattern the size chips already use, so it needs no JavaScript.
       */}
      <nav aria-label={t.brand} className="mb-8">
        <input type="checkbox" id={BRAND_EXPAND} className="peer sr-only" />

        <div className="flex max-h-[4.5rem] flex-wrap items-start gap-2 overflow-hidden text-sm peer-checked:max-h-none">
          {/*
           * No "Svi brendovi" reset chip any more: with brands multi-select, every
           * active chip switches itself off and shows it, so a chip whose only state was
           * "nothing is selected" said nothing the other 48 were not already saying.
           * What it did usefully — clear several at once — survives here, and only
           * appears when there is something to clear.
           */}
          {brands.length > 0 ? (
            <FilterChip
              href={buildHref({
                sizes: selected,
                brands: [],
                model: modelKey,
                query,
                kids: showKids,
                sort,
                onSale,
                shops,
                genders,
              })}
              active={false}
            >
              <span aria-hidden="true">×</span> {t.clearBrands}
            </FilterChip>
          ) : null}
          {brandChips.map((b) => (
            <FilterChip
              key={b.brand}
              href={buildHref({
                sizes: selected,
                brands: toggleBrand(b.brand),
                model: modelKey,
                query,
                kids: showKids,
                sort,
                onSale,
                shops,
                genders,
              })}
              active={selectedBrands.has(b.brand.toLowerCase())}
            >
              {b.brand}
            </FilterChip>
          ))}
        </div>

        {/*
         * Two labels rather than one with swapping text: `peer-checked:` compiles to a
         * sibling selector, so only a sibling of the checkbox can react to it. The row is
         * 44px tall so it is a real target under a thumb.
         */}
        <label
          htmlFor={BRAND_EXPAND}
          className="mt-2 flex h-11 cursor-pointer items-center justify-center gap-1.5 border-t border-neutral-200 text-sm text-neutral-600 peer-checked:hidden hover:text-neutral-900"
        >
          <span aria-hidden="true">⌄</span> {t.allBrands}
        </label>
        <label
          htmlFor={BRAND_EXPAND}
          className="mt-2 hidden h-11 cursor-pointer items-center justify-center gap-1.5 border-t border-neutral-200 text-sm text-neutral-600 peer-checked:flex hover:text-neutral-900"
        >
          <span aria-hidden="true">⌃</span> {t.fewerBrands}
        </label>
      </nav>

      {pastTheEnd ? (
        <div className="rounded-xl border border-dashed border-neutral-300 px-6 py-16 text-center">
          <p className="font-medium text-neutral-900">{t.emptyPage}</p>
          <Link
            href={buildHref({
              sizes: selected,
              brands,
              model: modelKey,
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
      ) : shown.items.length === 0 ? (
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
          {shown.items.map((offer) => (
            <li key={offer.offerId}>
              <OfferCard offer={offer} sizes={selected} />
            </li>
          ))}
        </ul>
      )}

      {shown.items.length > 0 && totalPages > 1 ? (
        <>
          <p className="mt-6 text-center text-sm text-neutral-600">
            {showingRange(firstOnPage, lastOnPage, shown.total)}
          </p>
          <Pager
            page={page}
            totalPages={totalPages}
            hrefFor={(p) =>
              buildHref({
                sizes: selected,
                brands,
                model: modelKey,
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

/** Ties the expander label to its checkbox. Fixed, since there is one brand list. */
const BRAND_EXPAND = 'brand-expand';

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
  model,
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
  model?: string;
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
  if (model) sp.set('model', model);
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
      // Stay where the reader is; see the note on the filter-bar chip.
      scroll={false}
      className={[
        // A brand name never breaks across lines: "Sergio Tacchini" wrapping turns one
        // chip into a three-line lozenge and, with the row stretching to match, drags
        // every chip beside it to the same height.
        'shrink-0 rounded-full border px-3 py-1 whitespace-nowrap transition',
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
