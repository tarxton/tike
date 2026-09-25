'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Filter links that use the sizes ticked on screen, not the ones last searched.
 *
 * Ticking a size on the results page only changes the form; the grid updates on
 * "Pretraži". Every filter link — gender, sale, shop, brand, sort — is rendered by the
 * server from the URL, so ticking 44 and then choosing "Muške" filtered by the sizes of the
 * previous search and quietly dropped the 44.
 *
 * One delegated listener rather than a handler on each chip, because the chips are server
 * components. It runs in the capture phase, ahead of the link's own handler, and only
 * steps in when the ticked sizes differ from the link's: it then cancels the default,
 * which Next's `Link` honours by not navigating, and navigates to the same destination
 * with the ticked sizes instead. The link's own `onClick` still runs, so the sort menu
 * still closes itself.
 *
 * Without JavaScript the links keep their server-built hrefs, which is the old behaviour.
 */
export function KeepTickedSizes() {
  const router = useRouter();

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      // New tab, new window, download: the browser's business, with the href as written.
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
        return;
      const link = (e.target as Element | null)?.closest?.('a[data-keep-sizes]');
      if (!(link instanceof HTMLAnchorElement)) return;

      const ticked = [
        ...document.querySelectorAll<HTMLInputElement>('input[name="velicina"]:checked'),
      ].map((input) => input.value);
      const url = new URL(link.href);
      const linked = (url.searchParams.get('velicina') ?? '').split(',').filter(Boolean);
      if (sameSizes(ticked, linked)) return;

      if (ticked.length > 0) url.searchParams.set('velicina', ticked.join(','));
      else url.searchParams.delete('velicina');
      // Different sizes are a different result set; page 3 of the old one means nothing.
      url.searchParams.delete('strana');

      e.preventDefault();
      // Every link marked for this stays in place when followed; see the chips' own notes.
      router.push(`${url.pathname}${url.search}`, { scroll: false });
    };

    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [router]);

  return null;
}

function sameSizes(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const left = a.map(Number).sort((x, y) => x - y);
  const right = b.map(Number).sort((x, y) => x - y);
  return left.every((value, i) => value === right[i]);
}
