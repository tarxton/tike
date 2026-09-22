import { describe, expect, it } from 'vitest';
import { brandSpellings, canonicalBrand } from './brand';
import { cleanModel, normalizeOffer } from './normalize';

describe('canonicalBrand', () => {
  it('joins the two names shops give 361 Degrees', () => {
    // Juventa writes "361", Đak "361 DEGREES": one company, and until joined, two brands
    // in the filter whose shoes matching never compared.
    expect(canonicalBrand('361')).toBe('361 Degrees');
    expect(canonicalBrand('361 DEGREES')).toBe('361 Degrees');
    expect(canonicalBrand('361°')).toBe('361 Degrees');
  });

  it('leaves every other brand as the shop wrote it', () => {
    expect(canonicalBrand('NIKE')).toBe('NIKE');
    expect(canonicalBrand('BOSS Orange')).toBe('BOSS Orange');
    expect(canonicalBrand(null)).toBeNull();
  });

  it('lists every spelling, longest first', () => {
    expect(brandSpellings('361')).toEqual(['361 Degrees', '361 degrees', '361°', '361']);
    expect(brandSpellings('Nike')).toEqual(['Nike']);
  });
});

describe('the 361 spellings in titles', () => {
  it('comes off the front whichever spelling the shop used', () => {
    expect(cleanModel('361 DEGREES PATIKE BIG3 6.0 ZA MUŠKARCE', '361 Degrees')).toBe('BIG3 6.0');
    // Juventa's title keeps its own "361" while the brand is stored as "361 Degrees".
    expect(cleanModel('361 BIG3 6.0', '361 Degrees')).toBe('BIG3 6.0');
  });

  it('is stored under the canonical name', () => {
    const offer = normalizeOffer({
      url: 'https://juventasport.com/product/1',
      externalId: '1',
      title: '361 BIG3 6.0',
      brand: '361',
      sku: null,
      imageUrl: null,
      imageUrls: [],
      brandLogoUrl: null,
      priceRaw: '199.00',
      originalPriceRaw: null,
      currency: 'BAM',
      gender: 'men',
      sizes: [
        {
          raw: '44',
          euRaw: '44',
          usRaw: null,
          ukRaw: null,
          inStock: true,
          gtin: null,
          priceRaw: null,
        },
      ],
    });
    expect(offer.brand).toBe('361 Degrees');
    expect(offer.model).toBe('BIG3 6.0');
    expect(offer.searchDoc).toContain('361 degrees');
  });
});
