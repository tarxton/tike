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
    logoUrl: '/shops/buzz.webp',
    name: 'Buzz Sneaker Station',
    baseUrl: 'https://www.buzzsneakers.ba',
    platform: 'nbshop' as const,
    sitemapUrl: 'https://www.buzzsneakers.ba/files/sitemap/BIH_ba/sitemap.xml',
    // Their sitemap lists the whole catalogue; only /patike/ is in scope.
    crawlConfig: { pathAllow: ['patike'] },
  },
  {
    slug: 'sportvision',
    logoUrl: '/shops/sportvision.svg',
    name: 'Sport Vision',
    baseUrl: 'https://www.sportvision.ba',
    platform: 'nbshop' as const,
    sitemapUrl: 'https://www.sportvision.ba/files/sitemap/BIH_ba/sitemap.xml',
    crawlConfig: { pathAllow: ['patike'] },
  },
  {
    // Runs NBSHOP 5.9.58, the same version as Buzz, so the existing adapter covers it
    // unchanged — this row is the entire change. Unlike Buzz and Sport Vision it is not
    // in their corporate group, so its prices move independently.
    slug: 'sportreality',
    logoUrl: '/shops/sportreality.png',
    name: 'Sport Reality',
    baseUrl: 'https://www.sportreality.ba',
    platform: 'nbshop' as const,
    sitemapUrl: 'https://www.sportreality.ba/files/sitemap/BIH_ba/sitemap.xml',
    crawlConfig: { pathAllow: ['patike'] },
  },
  {
    slug: 'officeshoes',
    logoUrl: '/shops/officeshoes.svg',
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
  {
    // Magento 2. Djak's operator gave written permission to crawl at one request per
    // second after an outreach email, having previously 403'd an identified crawler.
    // Their robots.txt never forbade product pages in the first place — it disallows
    // query strings and Magento's internal /catalog/ routes — so this crawl is within
    // the file as written; the reply removes the ambiguity.
    slug: 'djak',
    logoUrl: '/shops/djak.png',
    name: 'Đak Sport',
    baseUrl: 'https://www.djaksport.ba',
    platform: 'magento2' as const,
    sitemapUrl: 'https://www.djaksport.ba/sitemap.xml',
    // Their robots.txt asks for Crawl-Delay 1 and the operator confirmed the same number,
    // so this is both the polite floor and the agreed ceiling.
    minDelayMs: 1200,
    maxConcurrency: 1,
    crawlConfig: {
      // Product type is inside the slug ("nike-patike-air-max-…"), never a path segment,
      // so the same contains-filter Office Shoes needs. 3,642 of 14,291 sitemap URLs.
      pathContains: ['-patike-'],
      // Their own articles are titled after the products they discuss, so they match the
      // filter above and then fail to parse as products, which they are not.
      pathDeny: ['/blog/'],
      // Their Cloudflare rejects Node's TLS fingerprint and accepts curl carrying the
      // identical tike-bot User-Agent, from the same machine and IP. Their operator gave
      // written permission to crawl, so the client is what changes here, not the identity
      // or the rate. See the transport note in the crawl config contract.
      transport: 'curl' as const,
    },
  },
];

await withDb(async (db) => {
  for (const s of shops) {
    const [row] = await db
      .insert(shop)
      .values({
        currency: 'BAM',
        // Our own floor for a shop that publishes no Crawl-delay. Spread last so a shop
        // row can raise it: Djak asks for one request per second and its operator agreed
        // the same number, and a default quietly overriding that would break a promise.
        minDelayMs: 1200,
        maxConcurrency: 2,
        dealType: 'none',
        active: true,
        ...s,
      })
      .onConflictDoUpdate({
        target: shop.slug,
        set: {
          name: s.name,
          baseUrl: s.baseUrl,
          platform: s.platform,
          logoUrl: s.logoUrl,
          sitemapUrl: s.sitemapUrl,
          crawlConfig: s.crawlConfig,
          // Re-seeding must be able to tighten politeness, not just content.
          minDelayMs: 'minDelayMs' in s ? s.minDelayMs : 1200,
          maxConcurrency: 'maxConcurrency' in s ? s.maxConcurrency : 2,
          // `active` is deliberately absent: a shop switched off in the database — for an
          // opt-out, or a block — must not be switched back on by re-running the seed.
        },
      })
      .returning({ id: shop.id, slug: shop.slug });
    console.log(`seeded shop ${row?.slug} (id ${row?.id})`);
  }
});
