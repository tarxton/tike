'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { type SortKey } from '@tike/db';
import { t } from '@/lib/messages';

/**
 * Result ordering, as a menu of links.
 *
 * This was a `<select>` that submitted its form on `change`, which worked on a desktop
 * pointer and failed on a phone. Two reasons, and each is enough on its own:
 *
 *   - A `<select>` on iOS opens a wheel picker that fires `change` while the wheel is
 *     still moving, so the page navigated to whichever option the wheel passed rather
 *     than the one the user stopped on.
 *   - The form's only submit control was `sr-only`, a 1×1 clipped button. That is a
 *     keyboard fallback, and a touch screen has no keyboard — so if the change handler
 *     did not fire, for any reason, there was no way at all to apply a sort.
 *
 * Links have neither problem: one tap, one navigation, and the same behaviour on every
 * device. It also makes ordering work like every other filter on the page, which are
 * already links, so the back button and a shared URL both behave.
 *
 * It does now need a little JavaScript, which the first version did without. A native
 * `<details>` has no idea a link inside it navigated — the result reorders underneath
 * while the menu stays open over it — and on a phone there is no stray click to dismiss
 * it, so the only way to shut it was to tap the trigger again. Selecting an order closes
 * it, and so does a tap anywhere outside. Escape closes it too, which `<details>` does
 * not give you for free.
 */
export interface SortOption {
  key: SortKey | undefined;
  label: string;
  href: string;
}

export function SortMenu({
  sort,
  current,
  options,
}: {
  sort: SortKey | undefined;
  /** The label for the order in force, which the trigger shows. */
  current: string;
  /**
   * Every order with its URL already built.
   *
   * Hrefs rather than a builder function, because this is a client component now and a
   * function cannot cross that boundary — React refuses to serialise one, and the page
   * 500s rather than failing at the point of use.
   */
  options: SortOption[];
}) {
  const box = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    // `pointerdown` rather than `click`: a tap that starts outside should dismiss the
    // menu even if the finger lifts somewhere else, which is how every native menu on a
    // phone behaves.
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <details ref={box} open={open} className="relative">
      <summary
        onClick={(e) => {
          // The element would toggle itself, and then React would write `open` back from
          // state on the next render and undo it.
          e.preventDefault();
          setOpen((v) => !v);
        }}
        className="flex cursor-pointer list-none items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-900 hover:border-neutral-900 focus-visible:ring-2 focus-visible:ring-neutral-900/10 focus-visible:outline-none [&::-webkit-details-marker]:hidden"
      >
        <span className="text-neutral-600">{t.sortBy}:</span>
        <span className="font-medium">{current}</span>
        <span aria-hidden="true" className="text-neutral-400">
          ▾
        </span>
      </summary>

      <div className="absolute left-0 z-20 mt-1 min-w-52 rounded-lg border border-neutral-200 bg-white p-1 shadow-lg">
        {options.map((o) => {
          const active = o.key === sort;
          return (
            <Link
              key={o.key ?? 'relevance'}
              href={o.href}
              onClick={() => setOpen(false)}
              // Reordering the same results is not a reason to move the reader.
              scroll={false}
              aria-current={active ? 'true' : undefined}
              className={[
                'block rounded-md px-3 py-2 text-sm',
                'focus-visible:ring-2 focus-visible:ring-neutral-900/10 focus-visible:outline-none',
                active
                  ? 'bg-neutral-900 text-white'
                  : 'text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900',
              ].join(' ')}
            >
              {o.label}
            </Link>
          );
        })}
      </div>
    </details>
  );
}
