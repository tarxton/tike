import { describe, expect, it } from 'vitest';
import {
  formatCheckedAt,
  formatCount,
  formatPrice,
  formatSize,
  pluralResults,
  pluralShops,
  showingRange,
} from './messages';

describe('pluralResults', () => {
  it('uses the singular for counts ending in 1', () => {
    expect(pluralResults(1)).toBe('rezultat');
    expect(pluralResults(21)).toBe('rezultat');
    expect(pluralResults(101)).toBe('rezultat');
  });

  it('uses the plural for 11, which ends in 1 but is not singular', () => {
    expect(pluralResults(11)).toBe('rezultata');
    expect(pluralResults(111)).toBe('rezultata');
  });

  it('uses the plural everywhere else', () => {
    for (const n of [0, 2, 5, 17, 48, 100]) {
      expect(pluralResults(n)).toBe('rezultata');
    }
  });
});

describe('formatSize', () => {
  it('renders fractions the way shops write them', () => {
    expect(formatSize(44)).toBe('44');
    expect(formatSize(44.5)).toBe('44½');
    expect(formatSize(44.67)).toBe('44⅔');
    expect(formatSize(37.33)).toBe('37⅓');
  });
});

describe('formatPrice', () => {
  it('uses the BiH convention', () => {
    expect(formatPrice(12990, 'BAM')).toBe('129,90 KM');
    expect(formatPrice(4999, 'EUR')).toBe('49,99 €');
  });
});

describe('pluralShops', () => {
  it('uses the singular for counts ending in 1', () => {
    expect(pluralShops(1)).toBe('prodavnica');
    expect(pluralShops(21)).toBe('prodavnica');
  });

  it('uses the few-form for 2 to 4', () => {
    expect(pluralShops(2)).toBe('prodavnice');
    expect(pluralShops(3)).toBe('prodavnice');
    expect(pluralShops(4)).toBe('prodavnice');
    expect(pluralShops(22)).toBe('prodavnice');
  });

  it('uses the many-form for 5 and up', () => {
    for (const n of [5, 9, 10, 100]) {
      expect(pluralShops(n)).toBe('prodavnica');
    }
  });

  it('treats the teens as many, despite their last digit', () => {
    // 11-14 take the many-form even though 1-4 do not — the usual BCS exception.
    for (const n of [11, 12, 13, 14]) {
      expect(pluralShops(n)).toBe('prodavnica');
    }
  });
});

describe('showingRange', () => {
  it('names which slice of the whole set is on screen', () => {
    expect(showingRange(49, 96, 1207)).toBe('Prikazano 49-96 od 1.207.');
  });
});

describe('formatCount', () => {
  it('groups thousands the BiH way', () => {
    // 1.207, not 1,207 — the comma is the decimal separator here.
    expect(formatCount(1207)).toBe('1.207');
    expect(formatCount(48)).toBe('48');
  });
});

describe('formatCheckedAt', () => {
  // 18 September 2026, 18:45 in Sarajevo (CEST, UTC+2).
  const now = new Date('2026-09-18T16:45:00Z');

  it('says "danas" for earlier the same day, in BiH time', () => {
    expect(formatCheckedAt(new Date('2026-09-18T01:19:00Z'), now)).toBe('danas u 03:19');
  });

  it('says "jučer" for the day before', () => {
    expect(formatCheckedAt(new Date('2026-09-17T15:01:00Z'), now)).toBe('jučer u 17:01');
  });

  it('gives the date for anything older', () => {
    expect(formatCheckedAt(new Date('2026-09-16T15:25:00Z'), now)).toBe('16. 9. u 17:25');
  });

  it('uses the shops’ day, not the server’s UTC one', () => {
    // 23:30 UTC on the 17th is 01:30 on the 18th in Sarajevo: a crawl that ran this
    // morning must not read as yesterday.
    expect(formatCheckedAt(new Date('2026-09-17T23:30:00Z'), now)).toBe('danas u 01:30');
  });

  it('follows the clock change, one hour ahead in winter', () => {
    const winter = new Date('2026-12-10T12:00:00Z');
    expect(formatCheckedAt(new Date('2026-12-10T06:05:00Z'), winter)).toBe('danas u 07:05');
  });
});
