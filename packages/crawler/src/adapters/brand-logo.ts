/**
 * A brand logo's address as a page gives it, made absolute, or null when it is not a logo.
 *
 * Shops fill the slot even when they have nothing to put in it: Sport Reality shows its own
 * "no image" picture beside BDS, and taking that as BDS's logo would put the shop's
 * placeholder on every BDS page. Inline `data:` images are left out as well; they are
 * lazy-loading stand-ins, never the logo itself.
 */
export function brandLogoUrl(src: string | null | undefined, pageUrl: string): string | null {
  const trimmed = src?.trim();
  if (!trimmed || trimmed.startsWith('data:')) return null;
  if (/(no[_-]?image|placeholder|blank)\./i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed, pageUrl);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}
