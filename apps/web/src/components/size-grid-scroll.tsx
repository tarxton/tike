'use client';

import { useEffect } from 'react';

/**
 * Scroll the full size grid to where the reader's size is likely to be.
 *
 * The full view lists every size in order, so it opens on children's sizes — 16, 17, 18 —
 * with the adult ones a scroll below them. Opening it to look for 44½ and being shown 19
 * reads as the wrong list. So it opens at a ticked size if there is one, and at the first
 * adult size otherwise.
 *
 * An enhancement only: the toggle itself is CSS, so without JavaScript the full view still
 * opens, just at the top.
 */
export function SizeGridScroll({ toggleId, gridId }: { toggleId: string; gridId: string }) {
  useEffect(() => {
    const toggle = document.getElementById(toggleId) as HTMLInputElement | null;
    const grid = document.getElementById(gridId);
    if (!toggle || !grid) return;

    const scroll = () => {
      if (!toggle.checked) {
        grid.scrollTop = 0;
        return;
      }
      const target =
        grid.querySelector<HTMLElement>('label:has(input:checked)') ??
        grid.querySelector<HTMLElement>('label[data-base]');
      if (!target) return;
      // Measured against the grid and applied to the grid alone: scrollIntoView would move
      // the whole window as well and jump the reader down the page.
      grid.scrollTop += target.getBoundingClientRect().top - grid.getBoundingClientRect().top - 4;
    };

    // Arriving already open — a URL with a third ticked — positions it once.
    scroll();
    toggle.addEventListener('change', scroll);
    return () => toggle.removeEventListener('change', scroll);
  }, [toggleId, gridId]);

  return null;
}
