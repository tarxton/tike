import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeOffer } from '@tike/core';
import { parseMagento2, extractSlugStyleCode } from './magento2';
import { ParseError, UnavailableError } from '../errors';

const FIXTURES = join(import.meta.dirname, '../../fixtures/djak');
const load = (name: string) => readFileSync(join(FIXTURES, name), 'utf-8');

const IN_STOCK = 'https://www.djaksport.ba/puma-patike-puma-karmen-ii-jr-djevojcice-398878-01';
const SOLD_OUT = 'https://www.djaksport.ba/muske-patike-nike-air-presto-ct3550-003';
const ADIDAS = 'https://www.djaksport.ba/adidas-patike-vl-court-bold-za-zene-ih3081';

describe('parseMagento2', () => {
  it('reads identity, price and sizes from the swatch config', () => {
    const offer = parseMagento2(load('01-in-stock.html'), IN_STOCK);

    expect(offer.externalId).toBe('165725');
    expect(offer.title).toContain('PUMA KARMEN II');
    expect(offer.brand).toBe('PUMA');
    expect(offer.priceRaw).toBe('90.93');
    expect(offer.currency).toBe('BAM');
    expect(offer.sizes.map((s) => s.raw)).toEqual(['36', '37', '37.5', '38', '38.5', '39']);
  });

  it('reports the pre-sale price only when it is genuinely higher', () => {
    const offer = parseMagento2(load('01-in-stock.html'), IN_STOCK);
    expect(offer.originalPriceRaw).toBe('129.90');
  });

  it('treats every listed size as in stock, because Magento omits the rest', () => {
    const offer = parseMagento2(load('01-in-stock.html'), IN_STOCK);
    expect(offer.sizes.every((s) => s.inStock)).toBe(true);
  });

  it('takes the style code from the URL slug, where it is the only place it appears', () => {
    const offer = parseMagento2(load('01-in-stock.html'), IN_STOCK);
    expect(offer.sku).toBe('398878-01');
  });

  it('reads the audience out of the title', () => {
    expect(parseMagento2(load('01-in-stock.html'), IN_STOCK).gender).toBe('kids');
    expect(parseMagento2(load('03-in-stock.html'), ADIDAS).gender).toBe('women');
    // "ZA MUŠKARCE" is the men's phrase; the sold-out fixture carries it but cannot be
    // parsed into an offer, so men's is asserted through the brand-title helper instead.
  });

  it('raises UnavailableError, not a parse failure, for a sold-out product', () => {
    // 70% of Djak's sneakers are gone. Counting these as failures would hold the shop
    // permanently over the 5% circuit breaker while its markup is perfectly fine.
    expect(() => parseMagento2(load('02-sold-out.html'), SOLD_OUT)).toThrow(UnavailableError);
    expect(() => parseMagento2(load('02-sold-out.html'), SOLD_OUT)).not.toThrow(ParseError);
  });

  it('raises ParseError when the page is not a product at all', () => {
    expect(() => parseMagento2('<html><body>nope</body></html>', SOLD_OUT)).toThrow(ParseError);
  });

  it('keeps hyphenated third sizes, which adidas uses and a space-only rule dropped', () => {
    const offer = parseMagento2(load('03-in-stock.html'), ADIDAS);
    expect(offer.sizes.map((s) => s.raw)).toContain('38-2/3');

    const normalized = normalizeOffer(offer);
    // Six of these ten are thirds; a parser that only understood "38 2/3" kept four.
    expect(normalized.sizes).toHaveLength(10);
    expect(normalized.sizes.map((s) => s.sizeEu)).toContain(38.67);
    expect(normalized.sizes.map((s) => s.sizeEu)).toContain(37.33);
  });

  it('normalizes a whole offer end to end', () => {
    const normalized = normalizeOffer(parseMagento2(load('01-in-stock.html'), IN_STOCK));
    expect(normalized.price.amountMinor).toBe(9093);
    expect(normalized.inStock).toBe(true);
    expect(normalized.sizes.map((s) => s.sizeEu)).toEqual([36, 37, 37.5, 38, 38.5, 39]);
  });
});

describe('extractSlugStyleCode', () => {
  it('reads codes in both shapes the shop uses', () => {
    expect(extractSlugStyleCode('https://x/y/puma-patike-karmen-398878-01')).toBe('398878-01');
    expect(extractSlugStyleCode('https://x/y/adidas-patike-forum-hq6953')).toBe('HQ6953');
  });

  it('returns null rather than inventing a code from a word', () => {
    // A wrong style code is worse than none: tier 2 treats an equal code as proof that
    // two listings are the same shoe.
    expect(extractSlugStyleCode('https://x/y/nike-patike-za-muskarce')).toBeNull();
  });
});
