'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ModelSuggestion } from '@tike/db';
import { pluralColours, pluralShops, t } from '@/lib/messages';
import { RESULTS_ANCHOR } from '@/lib/anchors';

/** Long enough that a fast typist fires one request per word, not per letter. */
/** How often the post-navigation scroll checks whether the new page has arrived. */
const POLL_MS = 50;

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
 * Every row means results filtered to that model, carrying the ticked sizes with it — at
 * once on the results page, on "Pretraži" on the home page (see `applyOnPick`).
 *
 * A family holding one colourway used to go straight to that product's page. It read as a
 * shortcut and behaved as a trap: picking "Air Jordan 1" landed on a child's Air Jordan 1,
 * because that was the only colourway left in stock, with the size filter dropped on the
 * way and no sign of what had been narrowed. One row now means one destination, whether it
 * holds one colourway or thirty.
 */
export function ModelSearch({
  defaultValue,
  model,
  applyOnPick = false,
}: {
  defaultValue?: string;
  /** The model already chosen, when arriving at results filtered to one. */
  model?: { key: string; label: string };
  /**
   * Whether picking a row runs the search straight away.
   *
   * On the results page it does: the grid is right there and changes under the choice. On
   * the home page it does not — someone often names the shoe first and picks a size after,
   * and a pick that jumped to the results took the size grid away before it could be used.
   * There the pick only fills the form, and "Pretraži" runs it like everything else.
   */
  applyOnPick?: boolean;
}) {
  const router = useRouter();
  const listId = useId();
  const [value, setValue] = useState(model?.label ?? defaultValue ?? '');
  /*
   * The chosen model, travelling with the form as a hidden field.
   *
   * The box shows the model's name, but the name is not the query: "adidas Samba" typed
   * as text matches every Samba variation, while the chosen family is exactly one model.
   * Cleared the moment the text is edited, because then the box says something else.
   */
  const [modelKey, setModelKey] = useState<string | null>(model?.key ?? null);
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
  /**
   * Carry the reader down to the results once they exist.
   *
   * On a phone the filters and the first cards sit a screen and a half below the search
   * box, so choosing a model rearranged a grid nobody could see.
   *
   * Polling for the element rather than scrolling on a `useSearchParams` change: the
   * results are rendered by the server after the navigation, so at the moment the effect
   * would fire they may not be in the document yet, and a scroll to nothing is silent.
   *
   * `setTimeout` rather than `requestAnimationFrame`, which is what this used first.
   * Browsers pause rAF in a hidden tab, so switching away while the page loaded meant the
   * poll never ran once and the reader came back to a grid that had not moved. Timers
   * keep running, throttled.
   */
  const scrollToResults = (href: string) => {
    const target = new URL(href, window.location.origin);
    // Generous, because it is only a safety net: the loop exits the moment the new URL
    // is in place, and a dev-mode navigation can take several seconds where production
    // takes a few hundred milliseconds. Too tight a deadline simply does nothing, which
    // is indistinguishable from the feature not existing.
    const deadline = Date.now() + 8000;
    const tick = () => {
      if (Date.now() > deadline) return;
      // Wait for the navigation to commit, not merely for the anchor to exist. The page
      // being left behind has a `#rezultati` of its own, so polling for the element alone
      // finds the old one immediately, starts a smooth scroll, and has it cut off a
      // moment later when the new document replaces it — which looked like a 20px twitch.
      if (window.location.search !== target.search) {
        setTimeout(tick, POLL_MS);
        return;
      }
      const results = document.getElementById(RESULTS_ANCHOR);
      if (!results) {
        setTimeout(tick, POLL_MS);
        return;
      }
      results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    setTimeout(tick, POLL_MS);
  };

  const hrefFor = (s: ModelSuggestion) => {
    const sp = new URLSearchParams(window.location.search);
    sp.delete('q');
    sp.delete('brend');
    sp.delete('strana');
    sp.set('model', s.key);

    /*
     * The sizes that are ticked, not the ones the URL happens to carry.
     *
     * This row is a link the component builds itself, so it skips the form around it —
     * and on the home page the form has never been submitted, so the URL knows nothing
     * about the sizes on screen. Picking a model after ticking 44 threw the 44 away and
     * opened the whole catalogue of that model. Reading the boxes covers the results page
     * too, where someone can retick a size and pick a model without submitting in between.
     */
    const form = boxRef.current?.closest('form');
    const ticked = form
      ? [...form.querySelectorAll<HTMLInputElement>('input[name="velicina"]:checked')].map(
          (input) => input.value,
        )
      : [];
    if (ticked.length > 0) sp.set('velicina', ticked.join(','));
    else sp.delete('velicina');

    return `/patike?${sp.toString()}`;
  };

  const choose = (s: ModelSuggestion) => {
    setOpen(false);
    // Filling the box below is a change of `value`, and the suggestion effect runs on
    // every change once someone has typed: it fetched suggestions for the chosen name and
    // opened the list straight back over the pick. Only typing reopens it now.
    typed.current = false;
    /*
     * Put the chosen name in the box.
     *
     * Typing "p6" and picking "Nike P-6000" used to leave "p6" sitting there while the
     * results quietly changed behind it, so there was nothing on screen saying which
     * shoe had been selected, or that anything had been selected at all.
     */
    setValue([s.brand, s.model].filter(Boolean).join(' '));
    setModelKey(s.key);
    if (!applyOnPick) return;
    const href = hrefFor(s);
    router.push(href);
    scrollToResults(href);
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
      else {
        setValue('');
        setModelKey(null);
      }
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
      {modelKey ? <input type="hidden" name="model" value={modelKey} /> : null}
      <input
        type="search"
        name="q"
        value={value}
        onChange={(e) => {
          typed.current = true;
          setValue(e.target.value);
          setModelKey(null);
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
