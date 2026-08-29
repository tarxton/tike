import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

/**
 * Read client, over Neon's HTTP driver.
 *
 * Each query is one HTTPS request: no connection pool, edge/Workers compatible, and
 * a single round trip per statement — which is what the read path wants.
 *
 * IMPORTANT: this client cannot do transactions. Because every statement travels on
 * its own connection, `BEGIN` / `ROLLBACK` land in unrelated sessions and silently do
 * nothing (verified: a rolled-back insert survived). Anything that must be atomic —
 * the ingest pipeline replacing an offer's sizes, for example — belongs on the write
 * client with DATABASE_URL_UNPOOLED. See docs/adr/0001-neon-driver-split.md.
 */
function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Run `neon checkout <branch>` to pull the branch env.',
    );
  }
  return url;
}

let cached: ReturnType<typeof drizzle<typeof schema>> | undefined;

/** Lazily created, so importing this module never requires env at build time. */
export function db() {
  cached ??= drizzle(neon(connectionString()), { schema });
  return cached;
}
