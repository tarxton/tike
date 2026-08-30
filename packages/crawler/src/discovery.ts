import * as cheerio from 'cheerio';

/**
 * Finding product URLs on a shop that publishes no sitemap.
 *
 * The sitemap path is always preferred: it is what a shop offers crawlers deliberately,
 * and it costs one request instead of dozens. This is the fallback for shops that have
 * none — Office Shoes returns its homepage, with a 200, for every sitemap path tried.
 *
 * Their category listings load through the site's own pagination endpoint, which answers
 * with a fragment of product cards when the request declares itself an XHR. Requests keep
 * the identifying tike-bot User-Agent; nothing here works around a block, and a 403 stays
 * fatal exactly as it is everywhere else.
 */

/** The listing endpoint returns the full homepage instead of a fragment without this. */
export const XHR_HEADERS = { 'x-requested-with': 'XMLHttpRequest' } as const;

/** `/obuca-muska-obuca/2/48/order_asc` -> `/obuca-muska-obuca/2/48/order_asc/true?page=3` */
export function listingPageUrl(baseUrl: string, category: string, page: number): string {
  const path = category.replace(/\/+$/, '');
  return new URL(`${path}/true?page=${page}`, baseUrl).href;
}

/**
 * Product URLs from one listing fragment, in page order.
 *
 * Product links are the ones ending in a numeric id. Everything else on a card — brand
 * logo, wishlist, category crumbs — is filtered out by that shape alone.
 */
export function parseListingProducts(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const out: string[] = [];
  const seen = new Set<string>();

  $('article[id^="proid-"] a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const normalized = normalizeProductUrl(href, baseUrl);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
  });

  return out;
}

/**
 * Office Shoes writes `HTTPS://www.officeshoes.ba/...` — an uppercase scheme, which is
 * legal but compares unequal to every other URL we store, so it is folded here.
 *
 * Returns null for anything that is not a product URL.
 */
export function normalizeProductUrl(href: string, baseUrl: string): string | null {
  let resolved: URL;
  try {
    resolved = new URL(
      href.replace(/^HTTPS?:\/\//i, (m) => m.toLowerCase()),
      baseUrl,
    );
  } catch {
    return null;
  }
  if (resolved.host !== new URL(baseUrl).host) return null;
  // A product path ends in the shop's numeric id: /cipele-guess-plitke-patike-cribe/75024
  if (!/\/\d{3,}$/.test(resolved.pathname)) return null;
  resolved.hash = '';
  resolved.search = '';
  return resolved.href;
}

/**
 * True when a fetched listing is really the homepage.
 *
 * Unknown paths answer 200 with the full homepage rather than 404, so a walk that runs
 * past the last page would otherwise keep "succeeding" and re-ingesting whatever the
 * homepage happens to feature.
 */
export function isSoftNotFound(html: string): boolean {
  return !html.includes('proid-') || /<!DOCTYPE html PUBLIC/i.test(html);
}
