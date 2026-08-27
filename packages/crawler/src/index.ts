import type { ParsedOffer, Platform } from '@tike/contracts';

/**
 * Every shop is onboarded through a platform adapter, never a bespoke scraper.
 * One NBSHOP adapter already covers both sportvision.ba and buzzsneakers.ba;
 * adding a shop on a known platform must be a config row, not code.
 */
export interface ShopAdapter {
  readonly platform: Platform;

  /**
   * Yield product URLs. Discovery is always sitemap-driven — never blind spidering.
   * Implementations must honour robots.txt and the shop's crawl delay.
   */
  discover(context: AdapterContext): AsyncIterable<string>;

  /** Parse a single product page. Throws on unparseable input; the caller counts failures. */
  parse(html: string, url: string): ParsedOffer;
}

export interface AdapterContext {
  readonly shopSlug: string;
  readonly baseUrl: string;
  readonly sitemapUrl: string;
  /** Milliseconds between requests to this domain. Never below the shop's Crawl-delay. */
  readonly minDelayMs: number;
  readonly userAgent: string;
  fetch(url: string): Promise<string>;
}

/** Registry of implemented adapters, keyed by platform. Populated in Phase 1. */
export const adapters: Partial<Record<Platform, ShopAdapter>> = {};
