/**
 * A shop's mark, or its name when there is no mark.
 *
 * Served from our own /public/shops rather than the retailer's server: a logo on every
 * card would otherwise be a request to them on every page view, which is the same reason
 * product images are not hotlinked.
 *
 * The fallback is deliberate rather than an empty box — a new shop is useful the moment
 * its offers are in the catalogue, and waiting on someone to save a PNG is a silly thing
 * to block that on.
 */
export function ShopLogo({
  name,
  logoUrl,
  size = 'md',
}: {
  name: string;
  logoUrl: string | null;
  /** `sm` for the dense result cards, `md` for a product page row. */
  size?: 'sm' | 'md';
}) {
  const box = size === 'sm' ? 'h-4 w-12' : 'h-7 w-20';

  if (!logoUrl) {
    return (
      <span
        className={`inline-flex ${box} items-center justify-start truncate text-[11px] font-medium text-neutral-600`}
        title={name}
      >
        {name}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- static asset, no optimizer needed
    <img
      src={logoUrl}
      // The alt text carries the shop's name, which is the information the logo conveys.
      alt={name}
      loading="lazy"
      className={`${box} object-contain object-left`}
    />
  );
}
