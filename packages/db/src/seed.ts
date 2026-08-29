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
