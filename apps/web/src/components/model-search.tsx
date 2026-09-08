'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ModelSuggestion } from '@tike/db';
import { pluralColours, pluralShops, t } from '@/lib/messages';

/** Long enough that a fast typist fires one request per word, not per letter. */
const DEBOUNCE_MS = 150;
const MIN_QUERY = 2;

/**
 * Search box with model suggestions.
 *
 * The site's only client component, and it degrades to exactly what it replaced: a
 * plain `name="q"` field inside the filter form. With no JavaScript, a broken bundle or
 * an unreachable endpoint, typing and pressing Enter still runs the freeform search.
 * Nothing below is load-bearing for that.
 *
 * Suggestions are model *families* rather than products, because a product is one
 * colourway — listing those would put "AIR FORCE 1 '07" in the dropdown thirty times.
 * A family holding a single colourway goes straight to its product page; one holding
 * several goes to results filtered to that model, which is the colour picker.
 */
export function ModelSearch({ defaultValue }: { defaultValue?: string }) {
  const router = useRouter();
  const listId = useId();
  const [value, setValue] = useState(defaultValue ?? '');
  const [items, setItems] = useState<ModelSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);
  // Landing on ?q=dunk fills the box from the URL, and without this the effect would
  // treat that as typing: a request nobody asked for, and a dropdown covering the results
  // the user just navigated to. Suggestions belong to typing, not to arriving.
  const typed = useRef(false);

  useEffect(() => {
    if (!typed.current) return;
    const term = value.trim();
    // Nothing to clear here: a query too short to search simply hides the list at render
    // time. Clearing state instead would be a setState in an effect body, which cascades
    // an extra render for every keystroke below the threshold.
    if (term.length < MIN_QUERY) return;
    // Aborted rather than merely ignored, so a slow early response cannot overwrite the
    // list for a later, longer query — the classic typeahead race where the dropdown
    // ends up showing results for a prefix the user has already typed past.
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/modeli?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data: { items: ModelSuggestion[] } = await res.json();
        setItems(data.items);
        setActive(-1);
        setOpen(true);
      } catch {
        // Aborted, offline, or the endpoint is down. The field still submits.
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value]);

  // A click anywhere else closes the list. Pointerdown rather than click so the list is
  // gone before the thing underneath reacts.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  /**
   * Where a suggestion goes, built from the URL currently showing.
   *
   * Reading the live query string rather than taking the filters as props keeps this in
   * step with whatever the page has: sizes, gender, shop and sale all ride along. The
   * text query goes, because the picked model replaces it, and so does the brand — a
   * model already names its brand, and keeping an old one would guarantee no results
   * the moment someone filtered to adidas and then picked a Nike.
   */
  const hrefFor = (s: ModelSuggestion) => {
    if (s.slug) return `/patika/${s.slug}`;
    const sp = new URLSearchParams(window.location.search);
    sp.delete('q');
    sp.delete('brend');
    sp.delete('strana');
    sp.set('model', s.key);
    return `/patike?${sp.toString()}`;
  };

  const choose = (s: ModelSuggestion) => {
    setOpen(false);
    router.push(hrefFor(s));
  };

  // Stale rows from a longer query stay in state while the user deletes back past the
  // threshold; the length check keeps them off screen until a fresh fetch replaces them.
  const showList = open && value.trim().length >= MIN_QUERY && items.length > 0;

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Escape is handled before the open/closed check, and always cancelled, because a
    // `type="search"` field clears itself on Escape natively. This one is controlled, so
    // the browser would empty the DOM while React still held the text — no re-render, no
    // resync — and the next submit would send an empty query with the box looking full.
    // Measured: "dunk" in state, "" in the DOM, search returned the whole catalogue.
    if (e.key === 'Escape') {
      e.preventDefault();
      if (showList) setOpen(false);
      else setValue('');
      return;
    }
    if (!showList) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i <= 0 ? items.length - 1 : i - 1));
    } else if (e.key === 'Enter' && active >= 0) {
      // Only when a row is highlighted. Otherwise Enter belongs to the form, and the
      // freeform search it has always run.
      const chosen = items[active];
      if (chosen) {
        e.preventDefault();
        choose(chosen);
      }
    }
  };

  return (
    <div ref={boxRef} className="relative w-full max-w-xl">
      <input
        type="search"
        name="q"
        value={value}
        onChange={(e) => {
          typed.current = true;
          setValue(e.target.value);
        }}
        onFocus={() => items.length > 0 && setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={t.searchPlaceholder}
        aria-label={t.search}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus-visible:border-neutral-900 focus-visible:ring-2 focus-visible:ring-neutral-900/10 focus-visible:outline-none"
      />

      {showList ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-lg"
        >
          {items.map((s, i) => (
            <li key={s.key} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
              <button
                type="button"
                // Mousedown, not click: the input blurs first otherwise and the list is
                // already unmounted by the time the click would land.
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(s);
                }}
                onMouseEnter={() => setActive(i)}
                className={[
                  'flex w-full items-baseline gap-3 px-3 py-2 text-left text-sm',
                  i === active ? 'bg-neutral-100' : 'bg-white',
                ].join(' ')}
              >
                {/*
                 * Brand and model are one name, so they sit in one span separated by an
                 * ordinary word space. As separate flex items they were 8px apart and
                 * every row started its model at a different x, which read as a column
                 * that had failed to line up rather than as "Nike Air Max".
                 */}
                <span className="min-w-0 flex-1 truncate">
                  {s.brand ? <span className="text-neutral-500">{s.brand} </span> : null}
                  <span className="font-medium text-neutral-900">{s.model}</span>
                </span>
                <span className="shrink-0 text-xs text-neutral-400 tabular-nums">
                  {s.colourways > 1 ? `${s.colourways} ${pluralColours(s.colourways)}` : null}
                  {s.colourways > 1 && s.shopCount > 1 ? ' · ' : null}
                  {s.shopCount > 1 ? `${s.shopCount} ${pluralShops(s.shopCount)}` : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
