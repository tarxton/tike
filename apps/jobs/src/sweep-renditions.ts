import { sql } from 'drizzle-orm';
import { withDb } from '@tike/db';
import { RENDITION } from './normalize-image';
import { deleteObjects, listObjects, r2Client, readR2Config, type R2Config } from './r2';
import type { AwsClient } from 'aws4fetch';

/**
 * Delete the object prefixes no rendition points at any more.
 *
 * Superseded renditions are kept deliberately: they are the rollback for a transform that
 * turns out wrong, and the alternative to holding them is re-fetching every image from
 * five retailers — hours of load on somebody else's servers, one of whom crawls under a
 * written agreement about request rates. So they are swept on purpose, never on a
 * schedule.
 *
 * This is the one job here that destroys data, so it earns its checks. Every key the
 * catalogue currently serves is confirmed to exist before anything is deleted, and a
 * single miss aborts the run: an object that failed to upload while its row already said
 * it had would otherwise lose its last copy here, and only re-crawling five shops could
 * bring it back.
 *
 * Run with `pnpm --filter @tike/jobs sweep` to see what would go, and add `--confirm`
 * to actually delete.
 */

async function keysUnder(client: AwsClient, config: R2Config, prefix: string): Promise<string[]> {
  const all: string[] = [];
  let token: string | undefined;
  do {
    const page = await listObjects(client, config, prefix, token);
    all.push(...page.keys);
    token = page.next;
  } while (token);
  return all;
}

async function main(): Promise<void> {
  const confirm = process.argv.includes('--confirm');
  const config = readR2Config();
  const client = r2Client(config);

  await withDb(async (db) => {
    const rows = (await db.execute(sql`select key from image_cache where error is null`)).rows as {
      key: string;
    }[];
    const live = rows.map((r) => r.key);

    const stale = live.filter((k) => !k.startsWith(`${RENDITION}/`));
    if (stale.length > 0) {
      throw new Error(
        `${stale.length} cache rows still point outside ${RENDITION}/ — run the ` +
          `re-render first, or sweeping would delete images the site is serving.`,
      );
    }

    /*
     * Checked against a listing of the bucket, not by fetching each object.
     *
     * The first version asked the public r2.dev hostname for all 9.781 objects at
     * concurrency 16 and counted every non-200 as missing — which reported 6.573 of them
     * gone while the site was visibly serving them. Cloudflare rate-limits that hostname,
     * so most were 429s. A listing is one authenticated call per thousand keys, it is the
     * bucket's own answer rather than a cache's, and it cannot be throttled into a false
     * alarm — which here would have been a false *all-clear* in the other direction, had
     * the numbers happened to come back clean.
     */
    console.log(`checking all ${live.length} live objects against the bucket listing...`);
    const present = new Set(await keysUnder(client, config, `${RENDITION}/`));
    const missing = live.filter((k) => !present.has(k));
    if (missing.length > 0) {
      console.error(`\n${missing.length} live objects are missing from the bucket, e.g.:`);
      for (const k of missing.slice(0, 5)) console.error(`  ${k}`);
      throw new Error('refusing to sweep: the current rendition is incomplete');
    }
    console.log(`all ${live.length} present.\n`);

    // Everything the bucket holds that is not the current rendition. Listed rather than
    // derived from the cache rows, so an object orphaned by a failed run is swept too.
    const prefixes = ['products/', 'v2/'];
    let removed = 0;
    for (const prefix of prefixes) {
      const keys = await keysUnder(client, config, prefix);
      const doomed = keys.filter((k) => !k.startsWith(`${RENDITION}/`));
      console.log(`${prefix.padEnd(12)} ${doomed.length} objects`);
      if (!confirm) continue;
      for (let i = 0; i < doomed.length; i += 1000) {
        await deleteObjects(client, config, doomed.slice(i, i + 1000));
        removed += Math.min(1000, doomed.length - i);
        console.log(`  deleted ${removed}`);
      }
    }

    console.log(
      confirm
        ? `\nswept ${removed} objects`
        : `\nnothing deleted — re-run with --confirm once the numbers look right`,
    );
  });
}

await main();
