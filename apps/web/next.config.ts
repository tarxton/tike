import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NextConfig } from 'next';

/**
 * Env lives at the repo root because the Neon CLI writes it there (`neon env pull`),
 * and the jobs runner reads the same file. Next only looks in its own directory, so
 * load the root file here rather than keeping two copies in sync.
 */
const rootEnv = resolve(process.cwd(), '../../.env.local');
if (existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

/**
 * Origins allowed to request dev-only assets, from `DEV_ORIGINS` in `.env.local`.
 *
 * `next dev` serves its client chunks only to the origin it was started on, so opening
 * the dev server from a phone on the LAN (`192.168.1.6:3000`) gets server-rendered HTML
 * with every `<script>` 403ing — the page looks right and nothing hydrates, which reads
 * as "one control is broken" rather than "no JavaScript is running".
 *
 * Kept in env rather than committed because it is one machine's LAN address, and it
 * changes with the network.
 */
const devOrigins = (process.env.DEV_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source rather than a build step.
  transpilePackages: ['@tike/db', '@tike/core', '@tike/contracts'],
  ...(devOrigins.length > 0 ? { allowedDevOrigins: devOrigins } : {}),
};

export default nextConfig;
