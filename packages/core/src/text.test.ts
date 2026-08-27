import { describe, expect, it } from 'vitest';
import {
  expandQuery,
  extractStyleCode,
  foldDiacritics,
  normalizeForSearch,
  slugify,
} from './text.js';

describe('foldDiacritics', () => {
  it('folds every BCS diacritic', () => {
    expect(foldDiacritics('čćžšđ')).toBe('cczsd');
    expect(foldDiacritics('ČĆŽŠĐ')).toBe('CCZSD');
  });

  it('handles đ, which NFD does not decompose', () => {
    expect(foldDiacritics('đon')).toBe('don');
  });

  it('leaves plain ASCII untouched', () => {
    expect(foldDiacritics('Air Max 90')).toBe('Air Max 90');
  });
});

describe('normalizeForSearch', () => {
  it('makes an undiacriticked query match the real title', () => {
    expect(normalizeForSearch('muske patike')).toBe(normalizeForSearch('Muške   patike'));
  });
});

describe('slugify', () => {
  it('produces url-safe slugs', () => {
    expect(slugify('Nike Air Max 90 — Bijele')).toBe('nike-air-max-90-bijele');
    expect(slugify('Muške tenisice')).toBe('muske-tenisice');
  });
});

describe('expandQuery', () => {
  it('expands regional synonyms to patike', () => {
    expect(expandQuery('tenisice')).toEqual(['tenisice', 'patike']);
  });

  it('keeps original tokens and de-duplicates', () => {
    expect(expandQuery('patike tenisice')).toEqual(['patike', 'tenisice']);
  });

  it('passes unknown terms through unchanged', () => {
    expect(expandQuery('nike air max')).toEqual(['nike', 'air', 'max']);
  });
});

describe('extractStyleCode', () => {
  it('reads a hyphenated manufacturer code', () => {
    expect(extractStyleCode('Nike Air Max 90 DV0787-100')).toBe('DV0787-100');
  });

  it('normalizes a space-separated code', () => {
    expect(extractStyleCode('nike air force cw2288 111')).toBe('CW2288-111');
  });

  it('returns null when there is no code', () => {
    expect(extractStyleCode('Patike za trcanje')).toBeNull();
  });
});
