import type { ParsedOffer, Platform } from '@tike/contracts';
import { parseNbshop } from './adapters/nbshop';
import { parseOfficeshoes } from './adapters/officeshoes';

export { parseNbshop } from './adapters/nbshop';
export { ParseError } from './errors';
export { parseOfficeshoes } from './adapters/officeshoes';
export { PoliteFetcher, ForbiddenError, RobotsDisallowedError, USER_AGENT } from './fetcher';
export {
  parseSitemapLocs,
  isSitemapIndex,
  selectProductSitemap,
  filterByPath,
  filterByPathContains,
} from './sitemap';
export {
  XHR_HEADERS,
  listingPageUrl,
  parseListingProducts,
  normalizeProductUrl,
  isSoftNotFound,
} from './discovery';

/**
 * Every shop is onboarded through a platform adapter, never a bespoke scraper.
 * One NBSHOP adapter already covers both sportvision.ba and buzzsneakers.ba;
 * adding a shop on a known platform is a config row, not code.
 */
export type OfferParser = (html: string, url: string) => ParsedOffer;

export const parsers: Partial<Record<Platform, OfferParser>> = {
  nbshop: parseNbshop,
  officeshoes: parseOfficeshoes,
};

export function parserFor(platform: Platform): OfferParser {
  const parser = parsers[platform];
  if (!parser) throw new Error(`no adapter implemented for platform "${platform}"`);
  return parser;
}
