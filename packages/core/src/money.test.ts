import { describe, expect, it } from 'vitest';
import { discountPercent, formatMoney, parsePrice, toEurMinor } from './money';

describe('parsePrice', () => {
  it('parses the BiH comma-decimal format', () => {
    expect(parsePrice('129,90 KM')).toEqual({ amountMinor: 12990, currency: 'BAM' });
  });

  it('parses a dot-decimal price', () => {
    expect(parsePrice('129.90')).toEqual({ amountMinor: 12990, currency: 'BAM' });
  });

  it('handles a thousands separator', () => {
    expect(parsePrice('1.299,00 KM')).toEqual({ amountMinor: 129900, currency: 'BAM' });
  });

  it('parses an integer price with no decimals', () => {
    expect(parsePrice('129 KM')).toEqual({ amountMinor: 12900, currency: 'BAM' });
  });

  it('rejects junk', () => {
    expect(parsePrice('')).toBeNull();
    expect(parsePrice('KM')).toBeNull();
  });
});

describe('toEurMinor', () => {
  it('converts BAM to EUR at the fixed peg', () => {
    // 195.58 KM is 100.00 EUR at 1.95583.
    expect(toEurMinor({ amountMinor: 19558, currency: 'BAM' })).toBe(10000);
  });

  it('passes EUR through untouched', () => {
    expect(toEurMinor({ amountMinor: 4999, currency: 'EUR' })).toBe(4999);
  });
});

describe('formatMoney', () => {
  it('formats BAM the way BiH shops do', () => {
    expect(formatMoney({ amountMinor: 12990, currency: 'BAM' })).toBe('129,90 KM');
  });
});

describe('discountPercent', () => {
  it('computes a discount', () => {
    expect(
      discountPercent(
        { amountMinor: 8000, currency: 'BAM' },
        { amountMinor: 10000, currency: 'BAM' },
      ),
    ).toBe(20);
  });

  it('returns null when there is no original price or no saving', () => {
    expect(discountPercent({ amountMinor: 8000, currency: 'BAM' }, null)).toBeNull();
    expect(
      discountPercent(
        { amountMinor: 10000, currency: 'BAM' },
        { amountMinor: 10000, currency: 'BAM' },
      ),
    ).toBeNull();
  });
});
