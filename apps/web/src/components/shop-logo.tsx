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
  labelled = false,
}: {
  name: string;
  logoUrl: string | null;
  /** `sm` for the dense result cards, `md` for a product page row. */
  size?: 'sm' | 'md';
  /**
   * The shop's name is already written next to this mark.
   *
   * Then the mark carries no information of its own: its alt text would make a screen
   * reader say the name twice, and the text fallback would print it twice on screen.
   */
  labelled?: boolean;
}) {
  // Height fixed, width free.
  //
  // A fixed-width box plus object-contain leaves whatever the logo does not fill as dead
  // space: Sport Vision's mark is portrait (127x145) while Sport Reality's is 3.6:1, so a
  // shared 3:1 box gave the first a third of its width in logo and two thirds in gap. The
  // cap stops an unusually wide mark from crowding the row.
  const box = size === 'sm' ? 'h-4 max-w-16' : 'h-7 max-w-24';

  if (!logoUrl) {
    // Nothing to draw: the name beside it is already the whole message.
    if (labelled) return null;
    return (
      <span
        className={`inline-flex ${box} items-center truncate text-[11px] font-medium text-neutral-600`}
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
      // The alt text carries the shop's name, which is the information the logo conveys —
      // unless the name is already written next to it.
      alt={labelled ? '' : name}
      loading="lazy"
      className={`${box} w-auto object-contain object-left`}
    />
  );
}
