import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { productBySlug, type ProductOffer } from '@tike/db';
import { formatPrice, formatSize, pluralShops, t } from '@/lib/messages';
import { getSizes } from '@/lib/size';
import { ShopLogo } from '@/components/shop-logo';

export const dynamic = 'force-dynamic';

/**
 * One shoe, and every shop that sells it.
 *
 * The page the grouping work was for. A result card can say "3 prodavnice" honestly only
 * because this exists to answer which three and at what price; until now that card linked
 * to a single shop, which quietly made the count decorative.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const product = await productBySlug((await params).slug);
  if (!product) return { title: t.siteName };

  const name = [product.brand, product.model].filter(Boolean).join(' ');
  const cheapest = product.offers[0];
  return {
    title: `${name} — ${t.siteName}`,
    description: cheapest
      ? `${name}: ${formatPrice(cheapest.priceMinor, cheapest.currency)} u ${product.offers.length} ${pluralShops(product.offers.length)}.`
      : name,
    // Not indexable yet. Product pages are the eventual SEO asset, but §13 wants the
    // imprint, privacy and price-freshness pages live before anything is crawlable.
    robots: { index: false, follow: true },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [product, selected] = await Promise.all([productBySlug(slug), getSizes()]);
  if (!product) notFound();

  const name = [product.brand, product.model].filter(Boolean).join(' ');
  const cheapest = product.offers[0];
  const dearest = product.offers[product.offers.length - 1];
  const spread = cheapest && dearest ? dearest.priceMinor - cheapest.priceMinor : 0;

  return (
    <main className="mx-auto max-w-4xl px-5 py-8">
      <header className="mb-6">
        <Link href="/" className="text-xl font-semibold tracking-tight text-neutral-900">
          {t.siteName}
        </Link>
      </header>

      <div className="grid gap-8 sm:grid-cols-[minmax(0,320px)_1fr]">
        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
          <div className="aspect-square bg-neutral-50">
            {product.heroImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- Phase 2 moves images to R2
              <img src={product.heroImageUrl} alt={name} className="h-full w-full object-contain" />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-neutral-400">
                —
              </div>
            )}
          </div>
        </div>

        <div>
          {product.brand ? (
            <p className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
              {product.brand}
            </p>
          ) : null}
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-neutral-900">
            {product.model}
          </h1>

          {product.styleCode ? (
            <p className="mt-2 text-xs text-neutral-500">
              {t.styleCode} <span className="tabular-nums">{product.styleCode}</span>
            </p>
          ) : null}

          {product.offers.length === 0 ? (
            <p className="mt-6 rounded-xl border border-dashed border-neutral-300 px-4 py-6 text-sm text-neutral-600">
              {t.soldOut}
            </p>
          ) : (
            <>
              <p className="mt-4 flex flex-wrap items-baseline gap-x-2 text-sm text-neutral-600">
                <strong className="text-2xl font-semibold text-neutral-900">
                  {formatPrice(cheapest!.priceMinor, cheapest!.currency)}
                </strong>
                {spread > 0 ? (
                  <>
                    <span>–</span>
                    <span className="text-lg text-neutral-500">
                      {formatPrice(dearest!.priceMinor, dearest!.currency)}
                    </span>
                  </>
                ) : null}
                <span>
                  {' · '}
                  {product.offers.length} {pluralShops(product.offers.length)}
                </span>
              </p>

              {/*
               * The number worth putting in front of someone: what comparing is worth on
               * this exact shoe. It is the site's whole argument, stated once.
               */}
              {spread > 0 ? (
                <p className="mt-1 text-sm font-medium text-green-700">
                  Ušteda do {formatPrice(spread, cheapest!.currency)}
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>

      {product.offers.length > 0 ? (
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-medium text-neutral-700">{t.atShops}</h2>
          <ul className="space-y-3">
            {product.offers.map((offer, i) => (
              <li key={offer.offerId}>
                <ShopRow offer={offer} selected={selected} cheapest={i === 0 && spread > 0} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <footer className="mt-12 border-t border-neutral-200 pt-6 text-xs text-neutral-500">
        <p>{t.priceNote}</p>
        <p className="mt-1">{t.footerAbout}</p>
      </footer>
    </main>
  );
}

/**
 * One shop's offer, with the sizes it can actually sell.
 *
 * Per-shop sizes rather than a merged list: the cheapest shop having sold out of your
 * size is the single most useful thing this page can tell you, and a union would hide it.
 */
function ShopRow({
  offer,
  selected,
  cheapest,
}: {
  offer: ProductOffer;
  selected: number[];
  /** Only when some other shop is dearer — "cheapest" of two identical prices says nothing. */
  cheapest: boolean;
}) {
  const hasYourSize = selected.length > 0 && selected.some((s) => offer.sizesEu.includes(s));
  const shown = offer.sizesEu.slice(0, 14);
  const extra = offer.sizesEu.length - shown.length;

  return (
    // The whole row is the link. A separate "go to shop" button asked people to find the
    // one live target inside a block that is entirely about one shop.
    <a
      href={goHref(offer.offerId, selected, offer.sizesEu)}
      rel="nofollow sponsored noopener"
      target="_blank"
      className={[
        'block rounded-xl border bg-white p-4 transition',
        'hover:border-neutral-900 hover:shadow-sm',
        'focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
        cheapest ? 'border-neutral-900' : 'border-neutral-200',
      ].join(' ')}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-x-2">
          <ShopLogo name={offer.shopName} logoUrl={offer.shopLogoUrl} />
          {cheapest ? (
            <span className="rounded bg-neutral-900 px-1.5 py-0.5 text-[11px] font-semibold text-white">
              {t.cheapest}
            </span>
          ) : null}
          {selected.length > 0 ? (
            <span
              className={[
                'rounded px-1.5 py-0.5 text-[11px] font-semibold',
                hasYourSize ? 'bg-green-100 text-green-800' : 'bg-neutral-100 text-neutral-500',
              ].join(' ')}
            >
              {hasYourSize ? t.yourSize : t.noSizeHere}
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap items-baseline gap-x-2">
          <span
            className={[
              'text-lg font-semibold',
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
      </div>

      {offer.originalPriceMinor !== null ? (
        <p className="mt-1 text-xs text-neutral-500">
          {t.oldPrice}{' '}
          <span className="line-through">
            {formatPrice(offer.originalPriceMinor, offer.currency)}
          </span>
        </p>
      ) : null}

      <p className="mt-3 mb-1 text-[11px] text-neutral-500">{t.availableSizes}</p>
      <ul className="flex flex-wrap gap-1">
        {shown.map((s) => (
          <li
            key={s}
            className={[
              'rounded px-1.5 py-0.5 text-[11px] tabular-nums',
              selected.includes(s)
                ? 'bg-neutral-900 text-white'
                : 'bg-neutral-100 text-neutral-700',
            ].join(' ')}
          >
            {formatSize(s)}
          </li>
        ))}
        {extra > 0 ? <li className="px-1 py-0.5 text-[11px] text-neutral-500">+{extra}</li> : null}
      </ul>
    </a>
  );
}

/**
 * The size travels with the click, but only when this shop actually has it — logging a
 * size against a shop that could not sell it would poison the one number a retailer is
 * shown ("people wanted a 44 here").
 */
export function goHref(offerId: number, selected: number[], available: number[]): string {
  const match = selected.find((s) => available.includes(s));
  return match === undefined ? `/go/${offerId}` : `/go/${offerId}?velicina=${match}`;
}
