import { describe, expect, it } from 'vitest';
import { chipsToShow } from './size-chips';

describe('chipsToShow', () => {
  const wide = [36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48];

  it('shows everything when it fits', () => {
    expect(chipsToShow([40, 41, 42], [], 10)).toEqual([40, 41, 42]);
    expect(chipsToShow([40, 41, 42], [42], 3)).toEqual([40, 41, 42]);
  });

  it('keeps the filtered size even when it would be clipped', () => {
    const shown = chipsToShow(wide, [46], 10);
    expect(shown).toContain(46);
    expect(shown).toHaveLength(10);
  });

  it('shows the smallest sizes when nothing is filtered', () => {
    expect(chipsToShow(wide, [], 10)).toEqual([36, 37, 38, 39, 40, 41, 42, 43, 44, 45]);
  });

  it('displays in ascending order, not selected-first', () => {
    const shown = chipsToShow(wide, [47, 48], 5);
    expect(shown).toEqual([36, 37, 38, 47, 48]);
  });

  it('keeps a half or a third of a picked whole size, which is why the card is shown', () => {
    const thirds = [36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 46.67, 47.33];
    expect(chipsToShow(thirds, [46], 10)).toContain(46.67);
  });

  it('ignores a selected size the shoe does not have', () => {
    const shown = chipsToShow(wide, [39.5], 10);
    expect(shown).toEqual([36, 37, 38, 39, 40, 41, 42, 43, 44, 45]);
  });

  it('never shows more than the room it is given, however many are selected', () => {
    expect(chipsToShow(wide, wide, 4)).toHaveLength(4);
  });
});
