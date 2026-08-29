import { describe, expect, it } from 'vitest';
import {
  FUZZY_ACCEPT,
  gendersCompatible,
  isAutoMergeable,
  isPlausibleSizeSpan,
  matchOffers,
  normalizeStyleCode,
  similarity,
  sizeRangesOverlap,
  type MatchCandidate,
} from './matching';

const candidate = (over: Partial<MatchCandidate> = {}): MatchCandidate => ({
  offerId: 1,
  brand: 'Nike',
  model: 'DUNK LOW RETRO',
  sku: 'IM4414-200',
  gtin: null,
  gender: 'men',
  sizesEu: [41, 42, 43, 44, 45],
  ...over,
});

describe('normalizeStyleCode', () => {
  it('treats the same code written differently as equal', () => {
    expect(normalizeStyleCode('DV0787-100')).toBe(normalizeStyleCode('dv0787 100'));
    expect(normalizeStyleCode('KK0928')).toBe('KK0928');
  });

  it('rejects codes too short to be meaningful', () => {
    expect(normalizeStyleCode('AB1')).toBeNull();
    expect(normalizeStyleCode(null)).toBeNull();
  });
});

describe('sizeRangesOverlap', () => {
  it('accepts two adult ranges', () => {
    expect(sizeRangesOverlap([40, 41, 42], [41, 42, 43])).toBe(true);
  });

  it('rejects a kids range against an adult one', () => {
    // adidas Campus 00s C (kids) vs Campus 00s (adult): titles score 0.69 similar.
    expect(sizeRangesOverlap([28, 29, 30, 31], [40, 41, 42, 43])).toBe(false);
  });

  it('rejects a single shared boundary size', () => {
    expect(sizeRangesOverlap([33, 34, 35], [35, 36, 37])).toBe(false);
  });

  it('rejects a wide junior range that merely brushes an adult one', () => {
    // The bridge that chained kids to adult shoes: a listing running 28-40 shares two
    // sizes with an adult 38-48 listing, which a min/max test waves through.
    const junior = [28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40];
    const adult = [38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48];
    expect(sizeRangesOverlap(junior, adult)).toBe(false);
  });

  it('rejects empty input rather than guessing', () => {
    expect(sizeRangesOverlap([], [40, 41])).toBe(false);
  });
});

describe('gendersCompatible', () => {
  it('treats unknown as compatible', () => {
    expect(gendersCompatible(null, 'men')).toBe(true);
  });

  it('allows unisex alongside adult genders', () => {
    expect(gendersCompatible('unisex', 'women')).toBe(true);
  });

  it('never mixes kids with adult', () => {
    expect(gendersCompatible('kids', 'men')).toBe(false);
    expect(gendersCompatible('kids', 'unisex')).toBe(false);
  });
});

describe('similarity', () => {
  it('scores the same model written two ways highly', () => {
    expect(similarity('M CLIFTON 11', 'M Clifton 11')).toBeGreaterThan(0.9);
    expect(similarity('GEL-NUNOBIKI', 'Gel-Nunobiki')).toBeGreaterThan(0.9);
  });

  it('scores unrelated models low', () => {
    expect(similarity('DUNK LOW RETRO', 'TERREX ANYLANDER MID')).toBeLessThan(0.3);
  });
});

describe('matchOffers', () => {
  it('matches on a shared barcode regardless of title', () => {
    const a = candidate({ gtin: '198959700963', model: 'DUNK LOW' });
    const b = candidate({ offerId: 2, gtin: '198959700963', model: 'completely different' });
    expect(matchOffers(a, b)).toEqual({ method: 'gtin', confidence: 1 });
  });

  it('matches on the manufacturer style code', () => {
    const a = candidate({ sku: 'IM4414-200' });
    const b = candidate({ offerId: 2, sku: 'im4414 200', model: 'DUNK LOW' });
    expect(matchOffers(a, b)?.method).toBe('style_code');
  });

  it('matches the same model listed by two shops', () => {
    // Real pair observed across Buzz and Sport Vision.
    const a = candidate({ brand: 'Hoka', model: 'M CLIFTON 11', sku: null });
    const b = candidate({ offerId: 2, brand: 'Hoka', model: 'M Clifton 11', sku: null });
    const result = matchOffers(a, b);
    expect(result?.method).toBe('fuzzy');
    expect(isAutoMergeable(result!)).toBe(true);
  });

  it('refuses to merge a kids shoe into its adult namesake', () => {
    // The trap: these titles are ~0.69 similar, so string distance alone merges them.
    const adult = candidate({
      brand: 'adidas',
      model: 'CAMPUS 00s',
      sku: null,
      sizesEu: [40, 41, 42, 43],
    });
    const kids = candidate({
      offerId: 2,
      brand: 'adidas',
      model: 'CAMPUS 00s C',
      sku: null,
      gender: 'kids',
      sizesEu: [28, 29, 30, 31],
    });
    expect(matchOffers(adult, kids)).toBeNull();
  });

  it('never matches across brands', () => {
    const a = candidate({ brand: 'Nike', sku: null });
    const b = candidate({ offerId: 2, brand: 'adidas', sku: null });
    expect(matchOffers(a, b)).toBeNull();
  });

  it('returns null for a weak fuzzy pair instead of guessing', () => {
    const a = candidate({ model: 'DUNK LOW RETRO', sku: null });
    const b = candidate({ offerId: 2, model: 'AIR MAX ALPHA TRAINER 6', sku: null });
    expect(matchOffers(a, b)).toBeNull();
  });

  it('queues a middling fuzzy pair rather than merging it', () => {
    const a = candidate({ model: 'AIR FORCE 1 07', sku: null });
    const b = candidate({ offerId: 2, model: 'AIR FORCE 1 LV8 GS', sku: null });
    const result = matchOffers(a, b);
    if (result) {
      expect(result.method).toBe('fuzzy');
      expect(result.confidence).toBeLessThan(FUZZY_ACCEPT);
      expect(isAutoMergeable(result)).toBe(false);
    }
  });

  it('does not match an offer with itself', () => {
    expect(matchOffers(candidate(), candidate())).toBeNull();
  });

  it('never fuzzy-merges two listings from the same shop', () => {
    // A shop does not list one product twice, so similar titles in one catalogue are
    // different colourways. Merging them would hide one from the shopper.
    const a = candidate({ shopId: 2, model: 'NBC', sku: null });
    const b = candidate({ offerId: 2, shopId: 2, model: 'NBC', sku: null });
    expect(matchOffers(a, b)).toBeNull();
  });

  it('still merges same-shop listings when a code proves they are identical', () => {
    const a = candidate({ shopId: 2, sku: 'IM4414-200' });
    const b = candidate({ offerId: 2, shopId: 2, sku: 'IM4414-200' });
    expect(matchOffers(a, b)?.method).toBe('style_code');
  });
});

describe('isPlausibleSizeSpan', () => {
  it('accepts a normal adult run', () => {
    expect(isPlausibleSizeSpan([38, 40, 42, 44, 46])).toBe(true);
  });

  it('rejects a group spanning toddler to adult', () => {
    // Observed in the first real run: "F50 Hyperfast League" came out as 28.00-48.67
    // after union-find chained a junior listing to an adult one.
    expect(isPlausibleSizeSpan([28, 33, 40, 44, 48.67])).toBe(false);
  });
});
