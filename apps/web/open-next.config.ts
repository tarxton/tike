import { defineCloudflareConfig } from '@opennextjs/cloudflare';

/**
 * OpenNext's Cloudflare adapter, which is what lets a Next.js app run on Workers.
 *
 * Defaults only, deliberately. The adapter's optional caches (R2 incremental cache, a
 * KV-backed tag cache, the queue that powers on-demand revalidation) each need a bound
 * resource and each change what a stale page costs, so they are decisions to take with
 * measurements rather than switches to flip while proving the platform works at all.
 *
 * §12 called "OpenNext does not cleanly support Next.js 16 on Workers" the project's
 * top risk and asked for a hello-world deploy before anything was built on it. This is
 * that check, arriving late: the adapter declares `next: >=15.5.24 <16 || >=16.3.3` and
 * the app is on 16.3.3 exactly.
 */
export default defineCloudflareConfig();
