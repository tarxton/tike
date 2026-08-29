import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseNbshop, ParseError } from './nbshop';

/**
 * Fixture-driven: every assertion runs against real product HTML captured from
 * buzzsneakers.ba. Tests never touch a live shop.
 */
const fixturesDir = join(import.meta.dirname, '../../fixtures/buzz');
const manifest: { file: string; url: string }[] = JSON.parse(
  readFileSync(join(fixturesDir, 'manifest.json'), 'utf8'),
);

const load = (file: string) => readFileSync(join(fixturesDir, file), 'utf8');
const parseFixture = (i: number) => {
  const entry = manifest[i]!;
  return parseNbshop(load(entry.file), entry.url);
};

describe('parseNbshop', () => {
  it('parses every captured fixture without throwing', () => {
    for (const entry of manifest) {
      expect(() => parseNbshop(load(entry.file), entry.url)).not.toThrow();
    }
  });

  it('extracts identity and price from JSON-LD', () => {
    const offer = parseFixture(2); // Nike Dunk Low Retro
    expect(offer.title).toBe('Nike Patike NIKE DUNK LOW RETRO');
    expect(offer.brand).toBe('Nike');
    expect(offer.sku).toBe('IM4414-200');
    expect(offer.externalId).toBe('404423');
    expect(offer.priceRaw).toBe('259.00');
    expect(offer.currency).toBe('BAM');
  });

  it('scopes sizes to the main product, ignoring recommendation carousels', () => {
    // The page contains 10 further size widgets belonging to recommended products;
    // picking those up produced 155 sizes, including children's sizes on an adult shoe.
    const offer = parseFixture(2);
    expect(offer.sizes).toHaveLength(15);
    expect(offer.sizes.map((s) => s.euRaw)).toEqual([
      '40',
      '40.5',
      '41',
      '42',
      '42.5',
      '43',
      '44',
      '44.5',
      '45',
      '45.5',
      '46',
      '47',
      '47.5',
      '48.5',
      '49.5',
    ]);
  });

  it('marks disabled sizes as out of stock and keeps them', () => {
    const offer = parseFixture(2);
    const bySize = new Map(offer.sizes.map((s) => [s.euRaw, s]));

    // Out of stock at the shop, but still listed: this is what lets the UI say
    // "this shop has the shoe, just not in your size".
    expect(bySize.get('40')?.inStock).toBe(false);
    expect(bySize.get('40.5')?.inStock).toBe(false);
    expect(bySize.get('47.5')?.inStock).toBe(false);
    expect(bySize.get('49.5')?.inStock).toBe(false);

    expect(bySize.get('41')?.inStock).toBe(true);
    expect(bySize.get('44')?.inStock).toBe(true);

    expect(offer.sizes.filter((s) => s.inStock)).toHaveLength(11);
  });

  it('captures the per-size barcode, enabling exact cross-shop matching', () => {
    const offer = parseFixture(2);
    const size41 = offer.sizes.find((s) => s.euRaw === '41');
    expect(size41?.gtin).toBe('198959700963');
    // Out-of-stock rows carry no combination code, and that is expected.
    expect(offer.sizes.find((s) => s.euRaw === '40')?.gtin).toBeNull();
  });

  it('reads UK sizes from the shop instead of converting them', () => {
    const offer = parseFixture(2);
    const size41 = offer.sizes.find((s) => s.euRaw === '41');
    expect(size41?.ukRaw).toBe('7');
    expect(size41?.usRaw).toBe('8');
  });

  it('handles adidas third-sizes', () => {
    const offer = parseFixture(0); // adidas Handball Spezial W
    expect(offer.sku).toBe('KK0928');
    expect(offer.sizes.map((s) => s.euRaw)).toContain('40 2/3');
    expect(offer.sizes.map((s) => s.euRaw)).toContain('37 1/3');
  });

  it('detects a kids product from breadcrumb and title', () => {
    const offer = parseFixture(3); // Jordan Spizike Low BP
    expect(offer.gender).toBe('kids');
    // Kids sizes are labelled US-style ("11C", "1Y") with an EU value alongside.
    expect(offer.sizes.some((s) => s.raw.endsWith('C') || s.raw.endsWith('Y'))).toBe(true);
    expect(offer.sizes.every((s) => s.euRaw !== null)).toBe(true);
  });

  it('detects a women product', () => {
    const offer = parseFixture(1); // Nike W Air Force 1 '07
    expect(offer.gender).toBe('women');
  });

  it('never returns an empty size list for a valid product page', () => {
    // An empty list means a broken selector, which callers must treat as a parse
    // failure rather than writing an offer with no sizes.
    for (const entry of manifest) {
      const offer = parseNbshop(load(entry.file), entry.url);
      expect(offer.sizes.length).toBeGreaterThan(0);
    }
  });

  it('throws ParseError on a page with no product markup', () => {
    expect(() =>
      parseNbshop('<html><body>not a product</body></html>', 'https://x.test/p'),
    ).toThrow(ParseError);
  });
});
