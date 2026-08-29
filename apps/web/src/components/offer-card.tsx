import type { SearchResult } from '@tike/db';
import { formatPrice, formatSize, t } from '@/lib/messages';

/**
 * One listing.
 *
 * Images are hotlinked from the shop for now; the Phase 2 image pipeline stores
 * resized copies in R2 and serves them from our own CDN.
 */
export function OfferCard({ offer, sizes = [] }: { offer: SearchResult; sizes?: number[] }) {
  const shownSizes = offer.sizesEu.slice(0, 10);
  const extra = offer.sizesEu.length - shownSizes.length;

  return (
    <article className="group flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white transition hover:border-neutral-400">
      <a
        href={`/go/${offer.offerId}`}
        rel="nofollow sponsored noopener"
        target="_blank"
        className="flex flex-1 flex-col focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
      >
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
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span
                className={[
                  'text-base font-semibold',
                  offer.discountPercent === null ? 'text-neutral-900' : 'text-red-600',
                ].join(' ')}
              >
                {formatPrice(offer.priceMinor, offer.currency)}
              </span>

              {offer.originalPriceMinor !== null ? (
                <>
                  <span className="text-sm text-neutral-500 line-through">
                    {formatPrice(offer.originalPriceMinor, offer.currency)}
                  </span>
                  <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs font-semibold text-red-700 tabular-nums">
                    −{offer.discountPercent}%
                  </span>
                </>
              ) : null}
            </div>
            <span className="text-xs text-neutral-500">{offer.shopName}</span>
          </div>
        </div>
      </a>

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
