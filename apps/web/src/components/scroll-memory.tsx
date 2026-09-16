'use client';

import { useEffect } from 'react';

/**
 * Put the reader back where they were when they return to the results.
 *
 * Opening a shoe from the bottom of a long grid and pressing the back arrow used to land
 * at the top, with the card you had just been looking at a couple of screens away. On a
 * phone that is most of a minute of scrolling to get back to a place you never chose to
 * leave.
 *
 * The browser already does this correctly for its own back button — Next restores the
 * scroll position on a popstate — but the arrow in the header is an ordinary link, so it
 * pushes a *new* history entry and there is nothing to restore.
 *
 * `router.back()` would have been the small fix and it is wrong: a product page links on
 * to other colourways, so the previous entry is often another shoe rather than the search.
 * A control labelled "back to search" must not land on a different product. So the
 * position is remembered explicitly, against the exact URL it belongs to, and restored
 * only when the reader arrives back at that same URL.
 */
const KEY = 'tike:results-scroll';

interface Remembered {
  href: string;
  y: number;
}

export function ScrollMemory() {
  useEffect(() => {
    // Restore first, before any click handler can overwrite the entry.
    try {
      const raw = sessionStorage.getItem(KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Remembered;
        if (saved.href === window.location.href && saved.y > 0) {
          // Consumed on use, so a later visit to the same search starts at the top rather
          // than somewhere the reader has no memory of choosing.
          sessionStorage.removeItem(KEY);
          window.scrollTo(0, saved.y);
        }
      }
    } catch {
      // Private mode, or storage disabled. Losing the position is not worth an error.
    }

    /*
     * Delegated, and on the capture phase.
     *
     * One listener on the document rather than a handler on every card: the cards are
     * server components and making forty-eight of them client components to record one
     * number would be a poor trade. Capture, because the click has to be recorded before
     * the router begins tearing the page down.
     */
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      const link = target?.closest?.('a[href^="/patika/"]');
      if (!link) return;
      try {
        const entry: Remembered = { href: window.location.href, y: window.scrollY };
        sessionStorage.setItem(KEY, JSON.stringify(entry));
      } catch {
        // As above.
      }
    };

    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  return null;
}
