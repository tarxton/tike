import { sql } from 'drizzle-orm';
import { withDb } from '@tike/db';
import { normalizeImage, objectKey, RENDITION } from './normalize-image';
import { putObject, r2Client, readR2Config, R2NotConfiguredError } from './r2';

/**
 * Re-render every stored image into the current rendition.
 *
 * Reads from R2 rather than from the retailers. The pictures are already ours; fetching
 * nine thousand of them again would put hours of avoidable load on five shops to produce
 * bytes sitting in our own bucket, and one of those shops crawls under a written
 * agreement about request rates.
 *
 * The new object is written beside the old one under a new rendition prefix and the cache
 * row is repointed. Nothing is deleted: if a transform turns out to be wrong, rolling back
 * is an UPDATE rather than a re-crawl. Sweep the old prefix once the new one has been seen
 * in production.
 *
 * Resumable, like the fetch job: rows already on the current rendition are skipped, so an
 * interrupted run continues where it stopped.
 *
 * Run with `pnpm --filter @tike/jobs renormalize` (add `--dry-run` to transform without
 * writing, `--limit=N` to sample).
 */

const CONCURRENCY = 8;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : Number.MAX_SAFE_INTEGER;

  let config = null;
  try {
    config = readR2Config();
  } catch (err) {
    if (err instanceof R2NotConfiguredError && dryRun) {
      console.log(`${err.message}\n(continuing: --dry-run does not upload)`);
    } else {
      throw err;
    }
  }
  const client = config ? r2Client(config) : null;
  const publicBase = (config?.publicBaseUrl ?? '').replace(/\/$/, '');

  await withDb(async (db) => {
    // Only rows holding a real object, and only those not already on this rendition.
    const rows = (
      await db.execute(sql`
        select c.source_url as "sourceUrl", c.key as "key"
        from image_cache c
        where c.error is null and c.key not like ${RENDITION + '/%'}
        limit ${limit}
      `)
    ).rows as { sourceUrl: string; key: string }[];

    console.log(`${rows.length} images to re-render${dryRun ? ' — dry run' : ''}`);
    if (rows.length === 0) return;

    let done = 0;
    let failed = 0;
    let bytesBefore = 0;
    let bytesAfter = 0;

    const queue = [...rows];
    const worker = async () => {
      for (;;) {
        const row = queue.shift();
        if (!row) return;
        try {
          const res = await fetch(`${publicBase}/${row.key}`);
          if (!res.ok) throw new Error(`GET ${row.key} -> ${res.status}`);
          const input = Buffer.from(await res.arrayBuffer());
          bytesBefore += input.byteLength;

          const output = await normalizeImage(input);
          bytesAfter += output.bytes;

          // The shop is recoverable from the old key, whose second-to-last segment it is.
          const shopSlug = row.key.split('/').at(-2) ?? 'unknown';
          const nextKey = objectKey(shopSlug, row.sourceUrl);

          if (dryRun || !client || !config) {
            done += 1;
            continue;
          }

          await putObject(client, config, nextKey, output.data, 'image/webp');
          await db.execute(sql`
            update image_cache
            set key = ${nextKey}, width = ${output.width}, height = ${output.height},
                bytes = ${output.bytes}
            where source_url = ${row.sourceUrl}
          `);
          done += 1;
          if (done % 500 === 0) console.log(`  ${done}/${rows.length}`);
        } catch (err) {
          failed += 1;
          const reason = err instanceof Error ? err.message.slice(0, 160) : 'unknown';
          console.warn(`  failed ${row.key} — ${reason}`);
        }
      }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    const mb = (n: number) => (n / 1024 / 1024).toFixed(1);
    console.log(`\nre-rendered=${done} failed=${failed}`);
    console.log(`size ${mb(bytesBefore)}MB -> ${mb(bytesAfter)}MB`);
  });
}

await main();
