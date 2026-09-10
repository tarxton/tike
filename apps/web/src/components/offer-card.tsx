import Link from 'next/link';
import type { SearchResult } from '@tike/db';
import { ShopLogo } from './shop-logo';
import { formatPrice, formatSize, pluralShops, t } from '@/lib/messages';

/**
 * One result: either a shoe several shops carry, or a single unmatched listing.
 *
 * Both render as one card. While matching covers a fraction of the catalogue, hiding
 * unmatched listings would hide most of the catalogue, so a lone offer is simply a
 * group of one — the price reads as an exact price rather than "od", and the shop is
 * named instead of counted.
 *
 * Images are hotlinked from the shop for now; the Phase 2 image pipeline stores
 * resized copies in R2 and serves them from our own CDN.
 */
/**
 * `/go/123?velicina=44`, so the outclick records what the shopper was filtering for.
 *
 * Only a single selected size is passed: the click log answers "who wanted a 44 here",
 * and a list of sizes would make that question unanswerable.
 */
function goHref(offerId: number, sizes: number[]): string {
  const only = sizes.length === 1 ? sizes[0] : undefined;
  return only === undefined ? `/go/${offerId}` : `/go/${offerId}?velicina=${only}`;
}

/**
 * Where a card goes when you click it.
 *
 * Always the product page, one shop or five. Sending single-shop results straight out
 * made the site behave two different ways depending on something the shopper cannot see
 * from the card, and it skipped the page that shows sizes, the price history and the
 * freshness note. Matching now gives every offer a product, so the exception is gone.
 */
function CardLink({
  offer,
  sizes,
  children,
}: {
  offer: SearchResult;
  sizes: number[];
  children: React.ReactNode;
}) {
  const className =
    'flex flex-1 flex-col focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none';

  if (offer.productSlug !== null) {
    // The visitor's sizes ride along in the link.
    //
    // The product page used to learn them from a cookie, which is what made the whole
    // site remember a selection across visits. With that gone the sizes have to travel
    // the way every other filter here does — in the URL — or the page cannot say which
    // shop lacks your size, and the colourway shelf stops being filtered to sizes you
    // can actually buy.
    const href =
      sizes.length > 0
        ? `/patika/${offer.productSlug}?velicina=${sizes.join(',')}`
        : `/patika/${offer.productSlug}`;
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }

  // Only reachable before matching has run over a freshly crawled offer.
  return (
    <a
      href={goHref(offer.offerId, sizes)}
      rel="nofollow sponsored noopener"
      target="_blank"
      className={className}
    >
      {children}
    </a>
  );
}

export function OfferCard({ offer, sizes = [] }: { offer: SearchResult; sizes?: number[] }) {
  const shownSizes = offer.sizesEu.slice(0, 10);
  const extra = offer.sizesEu.length - shownSizes.length;
  const multiShop = offer.shopCount > 1;
  // Two shops at the same price is common — Buzz and Sport Vision share a price list —
  // and printing "86,00 – 86,00 KM" for it would be noise dressed as information.
  const hasSpread = offer.maxPriceMinor > offer.priceMinor;

  return (
    // `h-full` so a card fills its grid cell: shoes stock different numbers of sizes, and
    // without it the chip rows set each card's height individually and a row of cards ends
    // ragged. Most visible on the product page's colourway shelf, where two cards sit side
    // by side and the difference has nothing to hide behind.
    <article className="group flex h-full flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white transition hover:border-neutral-400">
      <CardLink offer={offer} sizes={sizes}>
        <div className="aspect-square overflow-hidden bg-neutral-50">
          {offer.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- see note above
            <img
              src={offer.imageUrl}
              alt={offer.title}
              loading="lazy"
              className="h-full w-full object-contain transition group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-neutral-400">
              —
            </div>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-2 p-3">
          {offer.brand ? (
            <p className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
              {offer.brand}
            </p>
          ) : null}
          <h3 className="line-clamp-2 text-sm leading-snug font-medium text-neutral-900">
            {offer.title}
          </h3>

          <div className="mt-auto flex flex-col gap-1 pt-1">
            {/*
             * Two numbers on a card need saying which is which. An unlabelled struck-out
             * price beside "od 86,00 KM" reads just as easily as the other shop's price —
             * and on the Speedcat it literally was both, 215 being the old price *and*
             * what Buzz charges. Each number now states what it is.
             */}
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span
                className={[
                  'text-base font-semibold',
                  offer.discountPercent === null ? 'text-neutral-900' : 'text-red-600',
                ].join(' ')}
              >
                {formatPrice(offer.priceMinor, offer.currency)}
              </span>
              {offer.discountPercent !== null ? (
                <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs font-semibold text-red-700 tabular-nums">
                  −{offer.discountPercent}%
                </span>
              ) : null}
            </div>

            {offer.originalPriceMinor !== null ? (
              <span className="text-xs text-neutral-500">
                {t.oldPrice}{' '}
                <span className="line-through">
                  {formatPrice(offer.originalPriceMinor, offer.currency)}
                </span>
              </span>
            ) : null}

            {/*
             * Whose prices these are, not just how many. A count alone makes someone open
             * the page to find out whether the shops are ones they would buy from.
             */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {offer.shops.map((shop) => (
                <ShopLogo key={shop.slug} name={shop.name} logoUrl={shop.logoUrl} size="sm" />
              ))}
            </div>

            {multiShop ? (
              <span className="text-xs font-medium text-neutral-700">
                {offer.shopCount} {pluralShops(offer.shopCount)}
                {hasSpread ? (
                  <span className="font-normal text-neutral-500">
                    {' · '}
                    {formatPrice(offer.priceMinor, offer.currency)} –{' '}
                    {formatPrice(offer.maxPriceMinor, offer.currency)}
                  </span>
                ) : null}
              </span>
            ) : null}
          </div>
        </div>
      </CardLink>

      <div className="border-t border-neutral-100 px-3 py-2">
        <p className="mb-1 text-[11px] text-neutral-500">{t.availableSizes}</p>
        <ul className="flex flex-wrap gap-1">
          {shownSizes.map((s) => (
            <li
              key={s}
              className={[
                'rounded px-1.5 py-0.5 text-[11px] tabular-nums',
                sizes.includes(s) ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-700',
              ].join(' ')}
            >
              {formatSize(s)}
            </li>
          ))}
          {extra > 0 ? (
            <li className="px-1 py-0.5 text-[11px] text-neutral-500">+{extra}</li>
          ) : null}
        </ul>
      </div>
    </article>
  );
}
