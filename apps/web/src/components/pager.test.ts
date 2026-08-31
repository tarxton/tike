import { describe, expect, it } from 'vitest';
import { pageWindow } from './pager';

describe('pageWindow', () => {
  it('lists every page when they all fit', () => {
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
  });

  it('keeps the first and last page reachable from the middle', () => {
    expect(pageWindow(10, 20)).toEqual([1, null, 9, 10, 11, null, 20]);
  });

  it('shows the page itself rather than an ellipsis hiding one page', () => {
    // A "…" standing in for a single number wastes the same space and hides a click,
    // so the gap between 4 and 6 becomes 5 rather than an ellipsis.
    expect(pageWindow(3, 6)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('does use an ellipsis once more than one page is hidden', () => {
    expect(pageWindow(3, 8)).toEqual([1, 2, 3, 4, null, 8]);
  });

  it('never repeats a page at the edges', () => {
    for (const page of [1, 2, 19, 20]) {
      const window = pageWindow(page, 20).filter((p): p is number => p !== null);
      expect(new Set(window).size).toBe(window.length);
    }
  });

  it('stays inside the range', () => {
    const window = pageWindow(1, 5).filter((p): p is number => p !== null);
    expect(Math.min(...window)).toBe(1);
    expect(Math.max(...window)).toBe(5);
  });
});
