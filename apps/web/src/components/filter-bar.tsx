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

        {allShops.map((shop) => (
          <Chip
            key={shop.slug}
            href={hrefFor({ shops: toggle(shops, shop.slug) })}
            active={shops.includes(shop.slug)}
            title={shop.name}
          >
            <ShopLogo name={shop.name} logoUrl={shop.logoUrl} size="sm" />
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
  title,
  children,
}: {
  href: string;
  active: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      title={title}
      aria-pressed={active}
      className={[
        'inline-flex items-center rounded-full border px-3 py-1 text-sm transition',
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
