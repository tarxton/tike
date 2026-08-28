/**
 * Capture real product pages as test fixtures.
 *
 * Fixtures are committed so the test suite never touches a live shop. Re-run this
 * only when a shop's markup changes and a fixture needs refreshing.
 *
 * Usage:
 *   node scripts/capture-fixtures.mjs <shop-slug> <base-url> <sitemap-url> [count]
 *
 * Rules enforced here, not left to the caller:
 *   - robots.txt is fetched first and every URL is checked against it
 *   - a single request at a time, spaced by the shop's Crawl-delay or 1.2s
 *   - identified User-Agent with a contact URL
 *   - a 403 aborts the run; it is never retried under a different identity
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import robotsParser from 'robots-parser';

const USER_AGENT = 'tike-bot/0.1 (+https://github.com/tarxton/tike; fixture capture)';
const DEFAULT_DELAY_MS = 1200;

const [, , shopSlug, baseUrl, sitemapUrl, countRaw] = process.argv;
if (!shopSlug || !baseUrl || !sitemapUrl) {
  console.error(
    'usage: node scripts/capture-fixtures.mjs <shop-slug> <base-url> <sitemap-url> [count]',
  );
  process.exit(1);
}
const count = Number(countRaw ?? 5);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
  if (res.status === 403) {
    throw new Error(
      `403 from ${url}. The shop is refusing an identified crawler; stop and contact them ` +
        `rather than working around it.`,
    );
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${url}`);
  return res.text();
}

const robotsTxt = await fetchText(new URL('/robots.txt', baseUrl).href);
const robots = robotsParser(new URL('/robots.txt', baseUrl).href, robotsTxt);
const crawlDelayMs = (robots.getCrawlDelay(USER_AGENT) ?? 0) * 1000;
const delayMs = Math.max(crawlDelayMs, DEFAULT_DELAY_MS);
console.log(`robots.txt read. crawl delay in use: ${delayMs}ms`);

if (!robots.isAllowed(sitemapUrl, USER_AGENT)) {
  throw new Error(`robots.txt disallows the sitemap itself: ${sitemapUrl}`);
}

await sleep(delayMs);
const sitemapXml = await fetchText(sitemapUrl);
const urls = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
console.log(`sitemap: ${urls.length} urls`);

// Prefer sneaker pages — the catalogue tike actually covers.
const candidates = urls.filter((u) => /\/patike\//.test(u));
const picked = (candidates.length >= count ? candidates : urls).slice(0, count);

const outDir = join(process.cwd(), 'fixtures', shopSlug);
await mkdir(outDir, { recursive: true });

const manifest = [];
for (const [i, url] of picked.entries()) {
  if (!robots.isAllowed(url, USER_AGENT)) {
    console.warn(`skipped (robots): ${url}`);
    continue;
  }
  await sleep(delayMs);
  const html = await fetchText(url);
  const name = `${String(i + 1).padStart(2, '0')}.html`;
  await writeFile(join(outDir, name), html, 'utf8');
  manifest.push({ file: name, url });
  console.log(`saved ${name}  ${(html.length / 1024).toFixed(0)}kb  ${url}`);
}

await writeFile(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log(`captured ${manifest.length} fixtures into fixtures/${shopSlug}/`);
