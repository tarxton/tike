import { describe, expect, it } from 'vitest';
import { nextSizes, parseSizes } from './sizes';

describe('parseSizes', () => {
  it('parses a comma list, sorted and de-duplicated', () => {
    expect(parseSizes('46,45,45')).toEqual([45, 46]);
  });

  it('keeps half and third sizes', () => {
    expect(parseSizes('44.5,44.67')).toEqual([44.5, 44.67]);
  });

  it('drops junk and implausible sizes', () => {
    expect(parseSizes('abc,0,999,44')).toEqual([44]);
    expect(parseSizes('')).toEqual([]);
    expect(parseSizes(undefined)).toEqual([]);
  });
});

describe('nextSizes', () => {
  it('adds a size, keeping the list sorted', () => {
    expect(nextSizes([46], '45')).toEqual([45, 46]);
  });

  it('removes a size that is already selected', () => {
    expect(nextSizes([45, 46], '45')).toEqual([46]);
  });

  it('clears everything when the size is empty', () => {
    // Regression: `Number('')` is 0, not NaN, so a numeric check treated the
    // "all sizes" button as selecting size 0 and never cleared the selection.
    expect(nextSizes([45, 46], '')).toEqual([]);
    expect(nextSizes([45], '   ')).toEqual([]);
  });

  it('ignores values outside the plausible size range', () => {
    expect(nextSizes([45], '0')).toEqual([45]);
    expect(nextSizes([45], '900')).toEqual([45]);
    expect(nextSizes([45], 'abc')).toEqual([45]);
  });
});
