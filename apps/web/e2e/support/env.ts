import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Put the repository's `.env.local` into the test process.
 *
 * `next start` reads that file itself, so the *server* is configured either way. The
 * test process is not: it queries the database directly to check that a click was
 * written and to choose which shoe to walk through, and without this it would find no
 * DATABASE_URL and every test would skip — a green run that checked nothing.
 *
 * Walks upward rather than assuming a working directory, because `pnpm e2e` runs from
 * the repository root through turbo and `playwright test` runs from `apps/web`.
 *
 * Anything already in the environment wins, so CI's own DATABASE_URL is never
 * overwritten by a file that happens to be lying around.
 */
export function loadRepoEnv(): void {
  if (process.env.DATABASE_URL) return;

  let dir = process.cwd();
  for (let up = 0; up < 5; up += 1) {
    const candidate = resolve(dir, '.env.local');
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}
