import { defineConfig } from 'drizzle-kit';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Env comes from `.env.local` at the repo root, written by `neon checkout` /
 * `neon env pull`. Loaded with Node's built-in loader so migrations need no
 * dotenv dependency.
 */
// drizzle-kit bundles this config, so `import.meta.dirname` is not available here.
// It runs with the package directory as cwd.
const envFile = resolve(process.cwd(), '../../.env.local');
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

/**
 * Migrations use the UNPOOLED connection: DDL over a pooled (PgBouncer) connection
 * can fail or behave oddly with session-level statements. The app itself uses the
 * pooled URL.
 */
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    'DATABASE_URL_UNPOOLED is not set. Run `neon checkout <branch>` to pull the branch env.',
  );
}

export default defineConfig({
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
