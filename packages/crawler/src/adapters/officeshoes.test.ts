import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ParseError } from '../errors';
import { parseOfficeshoes } from './officeshoes';

/**
 * Fixtures are parsed-content subsets of real Office Shoes pages (ADR-0002), captured
 * 2026-08-30. Per-size stock counts are stripped: tike stores availability, not
 * quantities.
 */
const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, '../../fixtures/officeshoes', name), 'utf8');

const URLS = {
  '01.html': 'https://www.officeshoes.ba/cipele-guess-plitke-patike-cribe/75024',
  '02.html': 'https://www.officeshoes.ba/cipele-gant-plitke-patike-beeker/73192',
  '03.html': 'https://www.officeshoes.ba/cipele-skechers-plitke-patike-uno-lite-2/75080',
} as const;

describe('parseOfficeshoes', () => {
  it('reads identity from schema.org microdata', () => {
    const offer = parseOfficeshoes(fixture('01.html'), URLS['01.html']);
    expect(offer.brand).toBe('Guess');
    expect(offer.sku).toBe('FMTCRI-BLK');
    expect(offer.externalId).toBe('75024');
    expect(offer.priceRaw).toBe('169.00');
    expect(offer.currency).toBe('BAM');
  });

  it('does not mistake the brand name for the product name', () => {
    // The brand carries a nested itemprop="name" and appears first in the DOM, so the
    // obvious lookup returns "Guess" as the model.
    const offer = parseOfficeshoes(fixture('01.html'), URLS['01.html']);
    expect(offer.title).toContain('Cribe');
    expect(offer.title.startsWith('Guess')).toBe(true);
  });

  it('reads the discounted price and the price it was reduced from', () => {
    const offer = parseOfficeshoes(fixture('02.html'), URLS['02.html']);
    expect(offer.priceRaw).toBe('97');
    expect(offer.originalPriceRaw).toBe('195,00');
  });

  it('leaves the original price null when the shop is not discounting', () => {
    const offer = parseOfficeshoes(fixture('01.html'), URLS['01.html']);
    expect(offer.originalPriceRaw).toBeNull();
  });

  it('keeps half sizes as the shop writes them', () => {
    const offer = parseOfficeshoes(fixture('03.html'), URLS['03.html']);
    expect(offer.sizes.map((s) => s.euRaw)).toEqual([
      '41',
      '42',
      '42.5',
      '43',
      '44',
      '45',
      '46',
      '47.5',
    ]);
  });

  it('treats every listed size as in stock, because sold-out ones are not rendered', () => {
    // 02 lists 41, 42, 44, 45 — 43 is absent rather than greyed out.
    const offer = parseOfficeshoes(fixture('02.html'), URLS['02.html']);
    expect(offer.sizes.map((s) => s.euRaw)).toEqual(['41', '42', '44', '45']);
    expect(offer.sizes.every((s) => s.inStock)).toBe(true);
  });

  it('reads gender from the shop’s own description', () => {
    expect(parseOfficeshoes(fixture('01.html'), URLS['01.html']).gender).toBe('men');
    expect(parseOfficeshoes(fixture('03.html'), URLS['03.html']).gender).toBe('men');
  });

  it('counts a page with no Product scope as a parse failure', () => {
    // Unknown paths answer 200 with the homepage, so a soft-404 arrives looking like a
    // successful fetch. It must not be written as an offer with no sizes.
    expect(() => parseOfficeshoes('<html><body>homepage</body></html>', URLS['01.html'])).toThrow(
      ParseError,
    );
  });

  it('never returns an offer with no sizes', () => {
    for (const [name, url] of Object.entries(URLS)) {
      expect(parseOfficeshoes(fixture(name), url).sizes.length).toBeGreaterThan(0);
    }
  });
});
