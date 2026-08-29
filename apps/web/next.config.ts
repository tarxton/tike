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

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source rather than a build step.
  transpilePackages: ['@tike/db', '@tike/core', '@tike/contracts'],
};

export default nextConfig;
