'use client';

import { useEffect } from 'react';

/**
 * Two things the full size grid needs from JavaScript, and neither is load-bearing.
 *
 * **Where it opens.** The full view lists every size in order, so it opens on children's
 * sizes — 16, 17, 18 — with the adult ones a scroll below. Opening it to look for 44½ and
 * being shown 19 reads as the wrong list, so it opens at a ticked size if there is one and
 * at the first size in the base grid otherwise.
 *
 * **That it scrolls at all.** iOS draws no scrollbar until a scroll is already happening
 * and ignores `::-webkit-scrollbar`, so on a phone the box looked like a box that simply
 * cut its contents off — reported from an iPhone 15. On a touch screen the CSS shows a
 * track of our own and this sizes and moves its thumb from the scroll position; on a
 * desktop the CSS leaves the browser's scrollbar alone and the thumb is simply not shown.
 *
 * Without JavaScript the toggle still works, the box still scrolls, and the only loss is
 * that it starts at the top with whatever scrollbar the browser draws.
 */
export function SizeGridScroll({
  toggleId,
  gridId,
  thumbId,
}: {
  toggleId: string;
  gridId: string;
  thumbId: string;
}) {
  useEffect(() => {
    const toggle = document.getElementById(toggleId) as HTMLInputElement | null;
    const grid = document.getElementById(gridId);
    const thumb = document.getElementById(thumbId);
    if (!toggle || !grid || !thumb) return;

    const drawThumb = () => {
      const { scrollHeight, clientHeight, scrollTop } = grid;
      const hidden = scrollHeight - clientHeight;
      if (hidden <= 0) {
        thumb.style.setProperty('--thumb-height', '0%');
        return;
      }
      // As a share of the track, so the thumb says how much of the list is on screen —
      // the one thing a scrollbar is for.
      const share = clientHeight / scrollHeight;
      thumb.style.setProperty('--thumb-height', `${Math.max(share * 100, 12)}%`);
      thumb.style.setProperty(
        '--thumb-top',
        `${(scrollTop / hidden) * (100 - Math.max(share * 100, 12))}%`,
      );
    };

    const position = () => {
      if (!toggle.checked) {
        grid.scrollTop = 0;
      } else {
        const target =
          grid.querySelector<HTMLElement>('label:has(input:checked)') ??
          grid.querySelector<HTMLElement>('label[data-base]');
        if (target) {
          // Measured against the grid and applied to the grid alone: scrollIntoView would
          // move the whole window as well and jump the reader down the page.
          grid.scrollTop +=
            target.getBoundingClientRect().top - grid.getBoundingClientRect().top - 4;
        }
      }
      drawThumb();
    };

    // Arriving already open — a URL with a third ticked — positions it once.
    position();
    toggle.addEventListener('change', position);
    grid.addEventListener('scroll', drawThumb, { passive: true });
    window.addEventListener('resize', drawThumb);
    return () => {
      toggle.removeEventListener('change', position);
      grid.removeEventListener('scroll', drawThumb);
      window.removeEventListener('resize', drawThumb);
    };
  }, [toggleId, gridId, thumbId]);

  return null;
}
