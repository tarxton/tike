import Link from 'next/link';
import { t } from '@/lib/messages';
import { ShopLogo } from './shop-logo';

/** The gender values the catalogue actually stores, with their BCS labels. */
export const GENDERS = [
  { value: 'men', label: t.genderMen },
  { value: 'women', label: t.genderWomen },
  { value: 'kids', label: t.genderKids },
  { value: 'unisex', label: t.genderUnisex },
] as const;

/**
 * Sale, shop and gender filters.
 *
 * Links rather than a form, like the brand chips beside them: each toggles one value in
 * the URL, so the state is shareable, the back button does what it should, and none of
 * it needs JavaScript.
 */
export function FilterBar({
  onSale,
  shops,
  genders,
  allShops,
  hrefFor,
}: {
  onSale: boolean;
  shops: string[];
  genders: string[];
  allShops: { slug: string; name: string; logoUrl: string | null }[];
  /** Builds a URL with one filter changed and everything else intact. */
  hrefFor: (change: { onSale?: boolean; shops?: string[]; genders?: string[] }) => string;
}) {
  const toggle = (list: string[], value: string) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  return (
    <div className="mb-6 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Chip href={hrefFor({ onSale: !onSale })} active={onSale}>
          {t.onSale}
        </Chip>

        <span className="mx-1 h-4 w-px bg-neutral-200" aria-hidden="true" />

        {GENDERS.map((g) => (
          <Chip
            key={g.value}
            href={hrefFor({ genders: toggle(genders, g.value) })}
            active={genders.includes(g.value)}
          >
            {g.label}
          </Chip>
        ))}

        <span className="mx-1 h-4 w-px bg-neutral-200" aria-hidden="true" />

        {/*
         * Logo and name, not the logo alone. A mark only works as a label for someone who
         * already recognises it, and these four are small BiH retailers — the filter was
         * asking people to identify a shop from a 16px monochrome mark before they could
         * decide whether to use it.
         */}
        {allShops.map((shop) => (
          <Chip
            key={shop.slug}
            href={hrefFor({ shops: toggle(shops, shop.slug) })}
            active={shops.includes(shop.slug)}
          >
            <ShopLogo name={shop.name} logoUrl={shop.logoUrl} size="sm" labelled />
            {shop.name}
          </Chip>
        ))}
      </div>

      {/*
       * Said out loud rather than left to be discovered: a third of the catalogue has no
       * gender on it, and those stay in the results. Someone who filters to "Muške" and
       * sees a women's shoe should know why rather than assume the filter is broken.
       */}
      {genders.length > 0 ? <p className="text-xs text-neutral-500">{t.genderNote}</p> : null}
    </div>
  );
}

function Chip({
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
      // Changing a filter must not throw the reader back to the top of the page. On a
      // phone the chips sit a screen and a half down, so the default scroll-to-top meant
      // every refinement cost a scroll back to where you already were.
      scroll={false}
      aria-pressed={active}
      className={[
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm whitespace-nowrap transition',
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
