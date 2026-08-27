/**
 * Size normalization — the core domain concept of the whole product.
 *
 * Invariant: sizes are normalized once, at ingest, into `sizeEu` (a number).
 * Nothing converts at query time. Everything else (US, UK) is derived for display.
 *
 * BiH shops list EU sizes, sometimes with thirds (`44 2/3`) or halves (`44.5`),
 * occasionally UK for Nike.
 */

export type Gender = 'men' | 'women' | 'unisex' | 'kids';

export interface ParsedSize {
  /** The shop's original string, kept verbatim for debugging and display. */
  raw: string;
  /** Canonical EU size, rounded to 2 decimals (44 2/3 -> 44.67). */
  sizeEu: number;
}

/** Parse "44", "44,5", "44.5", "44 2/3", "EU 44", "44 EUR" into a canonical EU number. */
export function parseEuSize(raw: string): ParsedSize | null {
  const cleaned = raw
    .toLowerCase()
    .replace(/eur?\b|europe|velicina|veličina|br\.?/g, '')
    .replace(',', '.')
    .trim();

  // Fractional form: "44 2/3", "44 1/3"
  const fraction = cleaned.match(/^(\d{1,2})\s+(\d)\/(\d)$/);
  if (fraction) {
    const whole = Number(fraction[1]);
    const numerator = Number(fraction[2]);
    const denominator = Number(fraction[3]);
    if (denominator === 0) return null;
    return { raw, sizeEu: round2(whole + numerator / denominator) };
  }

  // Decimal or integer: "44", "44.5"
  const decimal = cleaned.match(/^(\d{1,2}(?:\.\d)?)$/);
  if (decimal?.[1]) {
    const value = Number(decimal[1]);
    if (!isPlausibleEuSize(value)) return null;
    return { raw, sizeEu: round2(value) };
  }

  return null;
}

/** Guards against parsing a price, a percentage, or a stray number as a size. */
function isPlausibleEuSize(value: number): boolean {
  return value >= 15 && value <= 52;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * EU -> US/UK conversion, keyed by brand and gender with a generic fallback.
 *
 * PROVISIONAL DATA. These tables are the widely-published approximations and are
 * good enough for development, but each brand's official chart must be checked
 * before launch — Nike and adidas genuinely disagree at the same EU size. Add a
 * brand entry only once its chart has been verified, and record the source here.
 */
interface SizeRow {
  eu: number;
  us: number;
  uk: number;
}

const GENERIC_MEN: readonly SizeRow[] = [
  { eu: 39, us: 6.5, uk: 6 },
  { eu: 40, us: 7, uk: 6.5 },
  { eu: 41, us: 8, uk: 7.5 },
  { eu: 42, us: 8.5, uk: 8 },
  { eu: 43, us: 9.5, uk: 9 },
  { eu: 44, us: 10, uk: 9.5 },
  { eu: 45, us: 11, uk: 10.5 },
  { eu: 46, us: 12, uk: 11.5 },
  { eu: 47, us: 12.5, uk: 12 },
  { eu: 48, us: 13.5, uk: 13 },
];

const GENERIC_WOMEN: readonly SizeRow[] = [
  { eu: 36, us: 5.5, uk: 3.5 },
  { eu: 37, us: 6.5, uk: 4.5 },
  { eu: 38, us: 7.5, uk: 5.5 },
  { eu: 39, us: 8, uk: 6 },
  { eu: 40, us: 9, uk: 6.5 },
  { eu: 41, us: 9.5, uk: 7.5 },
  { eu: 42, us: 10.5, uk: 8 },
];

/** Brand overrides. Nike's UK sizing runs half a size below the generic table. */
const BRAND_TABLES: Record<string, Partial<Record<Gender, readonly SizeRow[]>>> = {
  nike: {
    men: GENERIC_MEN.map((row) => ({ ...row, uk: row.uk - 0.5 })),
  },
};

export interface ConvertedSize {
  eu: number;
  us: number | null;
  uk: number | null;
}

/**
 * Derive US/UK from a canonical EU size. Returns nulls rather than guessing when
 * the size falls outside the table — a wrong size is worse than a missing one.
 */
export function convertSize(
  sizeEu: number,
  options: { brand?: string; gender?: Gender } = {},
): ConvertedSize {
  const gender: Gender = options.gender ?? 'men';
  const brandKey = options.brand?.toLowerCase().trim();
  const table =
    (brandKey ? BRAND_TABLES[brandKey]?.[gender] : undefined) ?? defaultTableFor(gender);

  const exact = table.find((row) => row.eu === sizeEu);
  if (exact) return { eu: sizeEu, us: exact.us, uk: exact.uk };

  // Half/third sizes: interpolate only between adjacent known rows.
  const lower = [...table].reverse().find((row) => row.eu < sizeEu);
  const upper = table.find((row) => row.eu > sizeEu);
  if (!lower || !upper) return { eu: sizeEu, us: null, uk: null };

  const ratio = (sizeEu - lower.eu) / (upper.eu - lower.eu);
  return {
    eu: sizeEu,
    us: roundHalf(lower.us + ratio * (upper.us - lower.us)),
    uk: roundHalf(lower.uk + ratio * (upper.uk - lower.uk)),
  };
}

function defaultTableFor(gender: Gender): readonly SizeRow[] {
  return gender === 'women' ? GENERIC_WOMEN : GENERIC_MEN;
}

function roundHalf(value: number): number {
  return Math.round(value * 2) / 2;
}
