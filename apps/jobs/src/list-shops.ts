/**
 * Print the slugs of every active shop, as JSON.
 *
 * The scheduled crawl builds its matrix from this rather than a hardcoded list, so
 * onboarding a shop stays what it is meant to be — a row in `seed.ts` — instead of also
 * requiring somebody to remember a workflow file. Deactivating a shop, or marking one as
 * crawlable only outside CI, takes it out of the schedule by the same route.
 *
 * stdout is the matrix and nothing else, so anything worth saying goes to stderr.
 *
 * Run with `pnpm --filter @tike/jobs list-shops`.
 */

import { asc, eq } from 'drizzle-orm';
import { crawlConfigSchema } from '@tike/contracts';
import { shop, withDb } from '@tike/db';

await withDb(async (db) => {
  const rows = await db
    .select({ slug: shop.slug, crawlConfig: shop.crawlConfig })
    .from(shop)
    .where(eq(shop.active, true))
    .orderBy(asc(shop.slug));

  // A shop can be live on the site and still not crawlable from a GitHub runner. Đak is:
  // its WAF refuses the sitemap from datacentre addresses, so a matrix entry for it can
  // only ever fail, and would open an issue every night about a fault in nobody's code.
  const inCi = rows.filter((r) => crawlConfigSchema.parse(r.crawlConfig ?? {}).runsInCi);
  const skipped = rows.length - inCi.length;
  if (skipped > 0) console.error(`${skipped} active shop(s) crawl outside CI`);

  // Bare JSON on stdout: GitHub Actions reads this straight into a matrix.
  console.log(JSON.stringify(inCi.map((r) => r.slug)));
});
