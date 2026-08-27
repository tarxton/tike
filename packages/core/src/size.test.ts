import { describe, expect, it } from 'vitest';
import { convertSize, parseEuSize } from './size.js';

describe('parseEuSize', () => {
  it('parses a plain integer size', () => {
    expect(parseEuSize('44')?.sizeEu).toBe(44);
  });

  it('parses half sizes with either separator', () => {
    expect(parseEuSize('44.5')?.sizeEu).toBe(44.5);
    expect(parseEuSize('44,5')?.sizeEu).toBe(44.5);
  });

  it('parses third sizes used by Nike and adidas', () => {
    expect(parseEuSize('44 2/3')?.sizeEu).toBe(44.67);
    expect(parseEuSize('42 1/3')?.sizeEu).toBe(42.33);
  });

  it('strips local labels', () => {
    expect(parseEuSize('EU 44')?.sizeEu).toBe(44);
    expect(parseEuSize('veličina 44')?.sizeEu).toBe(44);
  });

  it('keeps the raw string for debugging', () => {
    expect(parseEuSize('44 2/3')?.raw).toBe('44 2/3');
  });

  it('rejects values that cannot be shoe sizes', () => {
    expect(parseEuSize('129')).toBeNull();
    expect(parseEuSize('0')).toBeNull();
    expect(parseEuSize('')).toBeNull();
    expect(parseEuSize('one size')).toBeNull();
  });
});

describe('convertSize', () => {
  it('converts EU 44 to US 10 / UK 9.5 on the generic table', () => {
    expect(convertSize(44)).toEqual({ eu: 44, us: 10, uk: 9.5 });
  });

  it('applies the Nike override for UK', () => {
    expect(convertSize(44, { brand: 'Nike', gender: 'men' })).toEqual({ eu: 44, us: 10, uk: 9 });
  });

  it('uses the women table when asked', () => {
    expect(convertSize(38, { gender: 'women' })).toEqual({ eu: 38, us: 7.5, uk: 5.5 });
  });

  it('interpolates between known rows for half sizes', () => {
    const converted = convertSize(44.5);
    expect(converted.us).toBe(10.5);
    expect(converted.uk).toBe(10);
  });

  it('returns nulls rather than guessing outside the table', () => {
    expect(convertSize(52)).toEqual({ eu: 52, us: null, uk: null });
  });
});
