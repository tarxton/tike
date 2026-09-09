import type { ParsedOffer, RawSize } from '@tike/contracts';
import { describe, expect, it } from 'vitest';
import { cleanModel, normalizeOffer, titleCase, NormalizationError } from './normalize';

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
  it('strips the brand as many times as it prefixes the name', () => {
    expect(cleanModel('Nike Patike NIKE DUNK LOW RETRO', 'Nike')).toBe('Dunk Low Retro');
  });

  it('strips category noise', () => {
    expect(cleanModel('adidas Patike HANDBALL SPEZIAL W', 'adidas')).toBe('Handball Spezial W');
  });

  it('copes with a missing brand', () => {
    expect(cleanModel('Patike RUNNER 5', null)).toBe('Runner 5');
  });

  it('leaves a shop that already capitalises sensibly alone', () => {
    expect(cleanModel('Jordan Patike Air Jordan 1 Zoom Air', 'Jordan')).toBe(
      'Air Jordan 1 Zoom Air',
    );
  });

  // Đak states the audience in every title. It is already a column and a filter chip.
  it.each([
    ['NIKE PATIKE AIR PRESTO ZA MUŠKARCE', 'NIKE', 'Air Presto'],
    ['SKECHERS PATIKE UNO ŽENE', 'SKECHERS', 'Uno'],
    ['NIKE PATIKE AIR MAX MOTIF ZA DEČAKE', 'NIKE', 'Air Max Motif'],
    ['PUMA PATIKE KARMEN II JR DJEVOJČICE', 'PUMA', 'Karmen II JR'],
    ['CONVERSE PATIKE RUN STAR MOTION CX PATIKE UNISEX', 'CONVERSE', 'Run Star Motion CX'],
    ['ADIDAS PATIKE SAMBA ZA DECAKE', 'ADIDAS', 'Samba'],
    ['NEW BALANCE PATIKE 9060 ZA ŽENE', 'NEW BALANCE', '9060'],
  ])('drops the audience from %s', (title, brand, expected) => {
    expect(cleanModel(title, brand)).toBe(expected);
  });

  // Five titles reached the database mojibaked, with the Č replaced by a question mark.
  it('drops an audience word whose diacritic did not survive the shop', () => {
    expect(cleanModel('NIKE PATIKE AIR MAX NOVA ZA DE?AKE', 'NIKE')).toBe('Air Max Nova');
  });

  it('drops an age band', () => {
    expect(cleanModel('ADIDAS PATIKE GRAND COURT DJEČACI UZRASTA 0-4 GODINE', 'ADIDAS')).toBe(
      'Grand Court',
    );
  });

  /*
   * The whole title is brand, category and audience — there is no model in it at all.
   * Stripping everything used to leave "ZA MUŠKARCE" standing as the name.
   */
  it('falls back to the category word rather than an empty name', () => {
    expect(cleanModel('REPLAY PATIKE ZA MUŠKARCE', 'REPLAY')).toBe('Patike');
  });

  it('never returns an empty string', () => {
    expect(cleanModel('PATIKE', 'PATIKE')).not.toBe('');
  });
});

describe('titleCase', () => {
  it('leaves a name that is not shouting untouched', () => {
    expect(titleCase('Air Jordan 1 Zoom Air')).toBe('Air Jordan 1 Zoom Air');
    expect(titleCase('New Balance U327L')).toBe('New Balance U327L');
  });

  it('lowers a shouted name', () => {
    expect(titleCase('HEART LIGHTS - BUBBLE LOVE')).toBe('Heart Lights - Bubble Love');
  });

  // A code read as a word ("Nike Air Max Tf") is worse than leaving the name shouting.
  it.each([
    ['AIR MAX 90', 'Air Max 90'],
    ['VAPOR 16 CLUB TF', 'Vapor 16 Club TF'],
    ['TERREX AX4 GTX', 'Terrex AX4 GTX'],
    ['RS-X HI', 'RS-X HI'],
    ['KARMEN II', 'Karmen II'],
    ['GRAND COURT 3.0', 'Grand Court 3.0'],
    ["BLAZER MID '77 JUMBO", "Blazer Mid '77 Jumbo"],
    ['W NIKE PACIFIC', 'W Nike Pacific'],
    ['E-SERIES AD', 'E-Series AD'],
  ])('keeps the codes in %s', (input, expected) => {
    expect(titleCase(input)).toBe(expected);
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

  it('records a genuine discount', () => {
    const result = normalizeOffer(offer({ priceRaw: '259.00', originalPriceRaw: '370.00' }));
    expect(result.originalPrice).toEqual({ amountMinor: 37000, currency: 'BAM' });
  });

  it('ignores an old price that is not actually higher', () => {
    // Shops repeat the current price in the old-price field on full-price products.
    expect(normalizeOffer(offer({ originalPriceRaw: '259.00' })).originalPrice).toBeNull();
    expect(normalizeOffer(offer({ originalPriceRaw: '100.00' })).originalPrice).toBeNull();
  });

  it('builds a diacritic-folded search document', () => {
    const result = normalizeOffer(
      offer({ title: 'Nike Patike GEL-KAYANO ČIŠĆENJE', brand: 'Nike' }),
    );
    expect(result.searchDoc).toContain('gel-kayano ciscenje');
  });
});
