import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isSoftNotFound,
  listingPageUrl,
  normalizeProductUrl,
  parseListingProducts,
} from './discovery';

const BASE = 'https://www.officeshoes.ba';

/** A real listing fragment, reduced to the article ids and links discovery reads. */
const listing = readFileSync(
  join(import.meta.dirname, '../fixtures/officeshoes/listing-page.html'),
  'utf8',
);

describe('listingPageUrl', () => {
  it('builds the shop’s own pagination url', () => {
    expect(listingPageUrl(BASE, '/obuca-muska-obuca/2/48/order_asc', 3)).toBe(
      'https://www.officeshoes.ba/obuca-muska-obuca/2/48/order_asc/true?page=3',
    );
  });

  it('tolerates a trailing slash on the configured category', () => {
    expect(listingPageUrl(BASE, '/obuca-lacoste/3834/', 1)).toBe(
      'https://www.officeshoes.ba/obuca-lacoste/3834/true?page=1',
    );
  });
});

describe('normalizeProductUrl', () => {
  it('lowercases the uppercase scheme the shop emits', () => {
    expect(normalizeProductUrl('HTTPS://www.officeshoes.ba/cipele-x-patike-y/71600', BASE)).toBe(
      'https://www.officeshoes.ba/cipele-x-patike-y/71600',
    );
  });

  it('resolves relative hrefs', () => {
    expect(normalizeProductUrl('/cipele-x-patike-y/71600', BASE)).toBe(
      'https://www.officeshoes.ba/cipele-x-patike-y/71600',
    );
  });

  it('rejects anything without a product id', () => {
    expect(normalizeProductUrl('/brend/lacoste', BASE)).toBeNull();
    expect(normalizeProductUrl('/prodavnice', BASE)).toBeNull();
  });

  it('rejects other hosts, so a listing cannot send the crawler off-site', () => {
    expect(normalizeProductUrl('https://example.com/cipele-x/71600', BASE)).toBeNull();
  });
});

describe('parseListingProducts', () => {
  it('finds the product urls in a real listing fragment', () => {
    const urls = parseListingProducts(listing, BASE);
    expect(urls.length).toBeGreaterThan(6);
    expect(urls.every((u) => /\/\d{3,}$/.test(u))).toBe(true);
    expect(urls).toContain(
      'https://www.officeshoes.ba/cipele-lacoste-plitke-patike-elite-active/71600',
    );
  });

  it('picks up the colour variants a card links, not just the card’s own product', () => {
    // One article links /68696, /70304 and /72324 beside its own /71600 — each is a
    // separate product page, so a card yields more than one product.
    const urls = parseListingProducts(listing, BASE);
    expect(urls).toContain(
      'https://www.officeshoes.ba/cipele-lacoste-plitke-patike-elite-active/68696',
    );
  });

  it('drops brand and navigation links', () => {
    const urls = parseListingProducts(listing, BASE);
    expect(urls.some((u) => u.includes('/brend/'))).toBe(false);
  });

  it('returns each url once', () => {
    const urls = parseListingProducts(listing, BASE);
    expect(new Set(urls).size).toBe(urls.length);
  });
});

describe('isSoftNotFound', () => {
  it('recognises the homepage the shop serves for unknown paths', () => {
    // Every sitemap path tried answered 200 with this, so walking past the last page
    // would otherwise look like a successful fetch forever.
    expect(isSoftNotFound('<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN">')).toBe(
      true,
    );
    expect(isSoftNotFound('<div>no products here</div>')).toBe(true);
  });

  it('accepts a real listing fragment', () => {
    expect(isSoftNotFound(listing)).toBe(false);
  });
});
