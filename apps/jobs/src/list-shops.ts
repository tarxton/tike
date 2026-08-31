/**
 * Print the slugs of every active shop, as JSON.
 *
 * The scheduled crawl builds its matrix from this rather than a hardcoded list, so
 * onboarding a shop stays what it is meant to be — a row in `seed.ts` — instead of also
 * requiring somebody to remember a workflow file. Deactivating a shop takes it out of the
 * schedule by the same route.
 *
 * Run with `pnpm --filter @tike/jobs list-shops`.
 */

import { asc, eq } from 'drizzle-orm';
import { shop, withDb } from '@tike/db';

await withDb(async (db) => {
  const rows = await db
    .select({ slug: shop.slug })
    .from(shop)
    .where(eq(shop.active, true))
    .orderBy(asc(shop.slug));

  // Bare JSON on stdout: GitHub Actions reads this straight into a matrix.
  console.log(JSON.stringify(rows.map((r) => r.slug)));
});
