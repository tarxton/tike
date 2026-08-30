import { shop } from './schema';
import { withDb } from './write-client';

/**
 * Seed the shops tike crawls. Idempotent: re-running updates the existing rows
 * rather than duplicating them, so it is safe to run against any branch.
 *
 * Politeness values here are the floor. The crawler additionally reads each shop's
 * robots.txt at run time and takes whichever delay is larger.
 */
const shops = [
  {
    slug: 'buzz',
    name: 'Buzz Sneaker Station',
    baseUrl: 'https://www.buzzsneakers.ba',
    platform: 'nbshop' as const,
    sitemapUrl: 'https://www.buzzsneakers.ba/files/sitemap/BIH_ba/sitemap.xml',
    // Their sitemap lists the whole catalogue; only /patike/ is in scope.
    crawlConfig: { pathAllow: ['patike'] },
  },
  {
    slug: 'sportvision',
    name: 'Sport Vision',
    baseUrl: 'https://www.sportvision.ba',
    platform: 'nbshop' as const,
    sitemapUrl: 'https://www.sportvision.ba/files/sitemap/BIH_ba/sitemap.xml',
    crawlConfig: { pathAllow: ['patike'] },
  },
  {
    slug: 'officeshoes',
    name: 'Office Shoes',
    baseUrl: 'https://www.officeshoes.ba',
    platform: 'officeshoes' as const,
    // No sitemap: every sitemap path answers 200 with the homepage.
    sitemapUrl: null,
    crawlConfig: {
      // The type sits inside the product slug (/cipele-guess-plitke-patike-cribe/75024),
      // not in a path segment of its own, so the first-segment filter cannot see it.
      pathContains: ['patike'],
      discovery: {
        kind: 'paginated' as const,
        // Their type filter is JavaScript, with no URL of its own, so the three
        // top-level footwear categories are the narrowest addressable scope. Listing
        // pages are cheap; only the sneakers among them get fetched as products.
        categories: [
          '/obuca-muska-obuca/2/48/order_asc',
          '/obuca-zenska-obuca/1/48/order_asc',
          '/obuca-djecija-obuca/3/48/order_asc',
        ],
        pageSize: 48,
        maxPages: 40,
      },
    },
  },
];

await withDb(async (db) => {
  for (const s of shops) {
    const [row] = await db
      .insert(shop)
      .values({
        ...s,
        currency: 'BAM',
        // Neither shop sets Crawl-delay; 1.2s is our own floor.
        minDelayMs: 1200,
        maxConcurrency: 2,
        dealType: 'none',
        active: true,
      })
      .onConflictDoUpdate({
        target: shop.slug,
        set: {
          name: s.name,
          baseUrl: s.baseUrl,
          platform: s.platform,
          sitemapUrl: s.sitemapUrl,
          crawlConfig: s.crawlConfig,
        },
      })
      .returning({ id: shop.id, slug: shop.slug });
    console.log(`seeded shop ${row?.slug} (id ${row?.id})`);
  }
});
