import { describe, expect, it } from 'vitest';
import { formatPrice, formatSize, pluralResults } from './messages';

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
