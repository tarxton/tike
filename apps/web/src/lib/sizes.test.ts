import { describe, expect, it } from 'vitest';
import { parseSizes } from './sizes';

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
