/**
 * Money is an integer in minor units plus a currency code. Never a float.
 *
 * BAM is pegged to EUR at a fixed rate, so no FX service is needed for BiH.
 * Floating currencies (RSD, MKD) would require a rates table — deliberately out
 * of scope until the market expands.
 */

export const BAM_PER_EUR = 1.95583 as const;

export type Currency = 'BAM' | 'EUR';

export interface Money {
  /** Amount in minor units (fening for BAM, cents for EUR). */
  amountMinor: number;
  currency: Currency;
}

/** Parse a shop's price string ("129,90 KM", "129.90", "1.299,00 KM") into minor units. */
export function parsePrice(raw: string, currency: Currency = 'BAM'): Money | null {
  // \u00A0 is a non-breaking space: BiH shops use it as a thousands separator.
  const cleaned = raw
    .replace(/[\s\u00A0]/g, '')
    .replace(/km|bam|eur|€/gi, '')
    .trim();
  if (!cleaned) return null;

  // Decide which separator is the decimal one: the last occurring separator wins,
  // but only if it is followed by exactly two digits.
  const normalized = /[.,]\d{2}$/.test(cleaned)
    ? cleaned.slice(0, -3).replace(/[.,]/g, '') + '.' + cleaned.slice(-2)
    : cleaned.replace(/[.,]/g, '');

  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return null;

  return { amountMinor: Math.round(value * 100), currency };
}

/** Convert to EUR minor units for cross-currency sorting. Exact for the BAM peg. */
export function toEurMinor(money: Money): number {
  if (money.currency === 'EUR') return money.amountMinor;
  return Math.round(money.amountMinor / BAM_PER_EUR);
}

/** Display formatting. BiH convention: "129,90 KM". */
export function formatMoney(money: Money): string {
  const major = (money.amountMinor / 100).toFixed(2).replace('.', ',');
  return money.currency === 'BAM' ? `${major} KM` : `${major} €`;
}

/** Discount percentage as a negative-friendly integer, or null when not on sale. */
export function discountPercent(current: Money, original: Money | null): number | null {
  if (!original || original.amountMinor <= current.amountMinor) return null;
  return Math.round(((original.amountMinor - current.amountMinor) / original.amountMinor) * 100);
}
