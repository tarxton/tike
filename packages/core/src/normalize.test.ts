import type { ParsedOffer, RawSize } from '@tike/contracts';
import { describe, expect, it } from 'vitest';
import { cleanModel, normalizeOffer, NormalizationError } from './normalize';

const size = (over: Partial<RawSize> = {}): RawSize => ({
  raw: '8',
  euRaw: '41',
  usRaw: '8',
  ukRaw: '7',
  inStock: true,
  gtin: null,
  priceRaw: null,
  ...over,
});

const offer = (over: Partial<ParsedOffer> = {}): ParsedOffer => ({
  url: 'https://shop.test/p/1',
  externalId: '1',
  title: 'Nike Patike NIKE DUNK LOW RETRO',
  brand: 'Nike',
  sku: 'IM4414-200',
  imageUrl: null,
  priceRaw: '259.00',
  originalPriceRaw: null,
  currency: 'BAM',
  gender: 'men',
  sizes: [size()],
  ...over,
});

describe('cleanModel', () => {
  it('strips the brand wherever it appears, not only at the start', () => {
    expect(cleanModel('Nike Patike NIKE DUNK LOW RETRO', 'Nike')).toBe('DUNK LOW RETRO');
  });

  it('strips category noise', () => {
    expect(cleanModel('adidas Patike HANDBALL SPEZIAL W', 'adidas')).toBe('HANDBALL SPEZIAL W');
  });

  it('copes with a missing brand', () => {
    expect(cleanModel('Patike RUNNER 5', null)).toBe('RUNNER 5');
  });
});

describe('normalizeOffer', () => {
  it('converts price to minor units', () => {
    expect(normalizeOffer(offer()).price).toEqual({ amountMinor: 25900, currency: 'BAM' });
  });

  it('prefers the shop US/UK sizes over the conversion table', () => {
    const [s] = normalizeOffer(offer()).sizes;
    expect(s?.sizeUs).toBe(8);
    expect(s?.sizeUk).toBe(7);
  });

  it('parses third sizes', () => {
    const result = normalizeOffer(offer({ sizes: [size({ euRaw: '40 2/3', raw: '40 2/3' })] }));
    expect(result.sizes[0]?.sizeEu).toBe(40.67);
  });

  it('merges two US sizes that share one EU size, OR-ing availability', () => {
    // Converse lists US 3.5 and US 4 both as EU 36. The user asks "can I buy EU 36
    // here?", so one variant in stock makes the EU size available.
    const result = normalizeOffer(
      offer({
        sizes: [
          size({ raw: '3.5', euRaw: '36', usRaw: '3.5', inStock: false }),
          size({ raw: '4', euRaw: '36', usRaw: '4', inStock: true }),
        ],
      }),
    );
    expect(result.sizes).toHaveLength(1);
    expect(result.sizes[0]?.sizeEu).toBe(36);
    expect(result.sizes[0]?.inStock).toBe(true);
  });

  it('keeps a merged size out of stock when no variant is available', () => {
    const result = normalizeOffer(
      offer({
        sizes: [
          size({ raw: '3.5', euRaw: '36', inStock: false }),
          size({ raw: '4', euRaw: '36', inStock: false }),
        ],
      }),
    );
    expect(result.sizes).toHaveLength(1);
    expect(result.sizes[0]?.inStock).toBe(false);
    expect(result.inStock).toBe(false);
  });

  it('drops sizes with no EU value rather than inventing one', () => {
    const result = normalizeOffer(
      offer({ sizes: [size(), size({ raw: 'one size', euRaw: null })] }),
    );
    expect(result.sizes).toHaveLength(1);
  });

  it('throws when nothing is left to store', () => {
    expect(() => normalizeOffer(offer({ sizes: [size({ euRaw: null })] }))).toThrow(
      NormalizationError,
    );
    expect(() => normalizeOffer(offer({ priceRaw: 'n/a' }))).toThrow(NormalizationError);
  });

  it('builds a diacritic-folded search document', () => {
    const result = normalizeOffer(offer({ title: 'Nike Patike MUŠKE ZOOM', brand: 'Nike' }));
    expect(result.searchDoc).toContain('muske zoom');
  });
});
