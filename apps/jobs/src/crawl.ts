/**
 * Crawl entrypoint. Invoked by GitHub Actions (`crawl.yml`) with a shop slug, and
 * locally via `pnpm crawl <shop>`. Queue-ready: the processor logic stays here so
 * moving to pg-boss/BullMQ later changes only the trigger.
 */

const shopSlug = process.argv[2];

if (!shopSlug) {
  console.error('usage: pnpm crawl <shop-slug>');
  process.exit(1);
}

console.log(`crawl requested for shop: ${shopSlug}`);
console.log('No adapters registered yet — Phase 1 adds the NBSHOP adapter.');
