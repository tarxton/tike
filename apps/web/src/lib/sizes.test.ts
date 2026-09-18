import { describe, expect, it } from 'vitest';
import { parseSizes, sizeMatch } from './sizes';

describe('parseSizes', () => {
  it('parses a comma list, sorted and de-duplicated', () => {
    expect(parseSizes('46,45,45')).toEqual([45, 46]);
  });

  it('keeps half and third sizes', () => {
    expect(parseSizes('44.5,44.67')).toEqual([44.5, 44.67]);
  });

  it('drops junk and implausible sizes', () => {
    // 0 in particular: an earlier toggle design let Number('') === 0 through.
    expect(parseSizes('abc,0,999,44')).toEqual([44]);
    expect(parseSizes('')).toEqual([]);
    expect(parseSizes(undefined)).toEqual([]);
  });
});

describe('sizeMatch', () => {
  it('is exact for the size itself', () => {
    expect(sizeMatch(44, [44])).toBe('exact');
    expect(sizeMatch(44.5, [44.5])).toBe('exact');
  });

  it('counts halves and thirds of a picked whole size as near', () => {
    expect(sizeMatch(44.33, [44])).toBe('near');
    expect(sizeMatch(44.5, [44])).toBe('near');
    expect(sizeMatch(44.67, [44])).toBe('near');
  });

  it('does not reach into the next size, or below', () => {
    expect(sizeMatch(45, [44])).toBeNull();
    expect(sizeMatch(43.67, [44])).toBeNull();
  });

  it('keeps a half picked on purpose to itself', () => {
    expect(sizeMatch(44.67, [44.5])).toBeNull();
  });
});
