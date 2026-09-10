import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';

/**
 * What crawlers may read.
 *
 * Host-aware on purpose. tike's first public address is a `*.workers.dev` placeholder,
 * and a placeholder that gets indexed becomes a competitor to the real domain later —
 * the same pages under two hostnames, with the throwaway one holding whatever authority
 * it accumulated. So the placeholder refuses everything, and only a real domain serves
 * the permissive rules below it.
 *
 * The disallow list on a real domain is not tidiness either:
 *
 *   - `/go/` is the outclick redirect. It is a tracked hop to a retailer, it must carry
 *     `nofollow sponsored`, and a crawler following it would log clicks nobody made —
 *     which corrupts the one number a retailer would be shown in a CPC conversation.
 *   - `/api/` answers the typeahead. It has no pages, only JSON.
 *   - `/patike` with a query string is the search itself. everysize disallows its own
 *     `/search/` for the same reason: faceted URLs multiply without bound, and the pages
 *     worth indexing are the curated landing pages Phase 3 builds, not every combination
 *     of size, brand and shop a visitor can produce.
 *
 * Product pages stay out of the sitemap until their slugs are stable. They are currently
 * re-derived on every matching run, so indexing them now would publish links that break
 * the next time a model name improves.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const host = (await headers()).get('host') ?? '';
  const isPlaceholder = host.endsWith('.workers.dev') || host.startsWith('localhost');

  if (isPlaceholder) {
    return { rules: [{ userAgent: '*', disallow: '/' }] };
  }

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/go/', '/api/', '/patike?'],
      },
    ],
  };
}
