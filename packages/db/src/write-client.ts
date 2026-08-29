import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import * as schema from './schema.js';

/**
 * Write client, over Neon's WebSocket driver.
 *
 * Unlike the HTTP client in `client.ts`, this one holds a real session, so
 * transactions work. Anything that must be atomic uses it — notably the ingest
 * pipeline, where an offer and its size rows have to land together or not at all.
 *
 * Uses DATABASE_URL_UNPOOLED: PgBouncer does not support session-level state, and
 * transactions over the pooled endpoint behave unpredictably.
 *
 * See docs/adr/0001-neon-driver-split.md.
 */
function connectionString(): string {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL_UNPOOLED is not set. Run `neon checkout <branch>` to pull the branch env.',
    );
  }
  return url;
}

/**
 * Opens a pool, runs `fn`, and always closes the pool. Jobs are short-lived
 * processes, so holding a module-level pool would keep them alive after the work
 * is done.
 */
export async function withDb<T>(
  fn: (db: ReturnType<typeof drizzle<typeof schema>>) => Promise<T>,
): Promise<T> {
  const pool = new Pool({ connectionString: connectionString() });
  try {
    return await fn(drizzle(pool, { schema }));
  } finally {
    await pool.end();
  }
}
