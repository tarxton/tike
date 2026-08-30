/** Extract <loc> values from a sitemap or sitemap index. */
export function parseSitemapLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]!).filter(Boolean);
}

/**
 * Keep only URLs whose first path segment is allowed for this shop.
 *
 * Filtering before fetching matters twice over: it keeps the crawl inside the catalogue
 * tike covers, and it means thousands of apparel pages are never requested at all.
 */
export function filterByPath(urls: string[], pathAllow: string[]): string[] {
  if (pathAllow.length === 0) return urls;
  const allowed = new Set(pathAllow.map((p) => p.toLowerCase()));
  return urls.filter((u) => {
    try {
      const segment = new URL(u).pathname.split('/').filter(Boolean)[0]?.toLowerCase();
      return segment ? allowed.has(segment) : false;
    } catch {
      return false;
    }
  });
}

/**
 * Keep only URLs whose path contains one of the given fragments.
 *
 * The looser sibling of `filterByPath`, for shops that bury the category inside the
 * product slug instead of giving it a path segment of its own.
 */
export function filterByPathContains(urls: string[], needles: string[]): string[] {
  if (needles.length === 0) return urls;
  const lowered = needles.map((n) => n.toLowerCase());
  return urls.filter((u) => {
    try {
      const path = new URL(u).pathname.toLowerCase();
      return lowered.some((n) => path.includes(n));
    } catch {
      return false;
    }
  });
}

/** True when the document is a sitemap index rather than a list of pages. */
export function isSitemapIndex(xml: string): boolean {
  return /<sitemapindex[\s>]/i.test(xml);
}

/**
 * Pick the product sitemap out of an index.
 *
 * NBSHOP publishes several (product, product_group, list_product, news, page, store).
 * Only `product.xml` lists individual product pages; `product_group` and `list_product`
 * are category listings, which would waste a crawl and parse as failures.
 */
export function selectProductSitemap(locs: string[]): string | null {
  return locs.find((l) => /\/product\.xml$/i.test(l)) ?? null;
}
