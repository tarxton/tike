import Link from 'next/link';
import { t } from '@/lib/messages';

/**
 * Numbered pagination.
 *
 * Offset-based rather than keyset. Keyset never double-counts a row when the data
 * shifts underneath a reader, which is the textbook answer — but it can only offer
 * "next", and tike's growth plan is programmatic landing pages that need addressable,
 * linkable page numbers. The write side is a crawl every few hours, not a live feed, so
 * the drift keyset protects against is a narrow window and its worst outcome is one
 * repeated card.
 *
 * Revisit if a page ever costs more than it should: `count(*) over()` already gives the
 * total, so switching the *reader* to keyset later is a change to this component and the
 * order clause, not to the data.
 */
export function Pager({
  page,
  totalPages,
  hrefFor,
}: {
  page: number;
  totalPages: number;
  /** Builds a URL for a page while keeping every active filter. */
  hrefFor: (page: number) => string;
}) {
  if (totalPages <= 1) return null;

  return (
    <nav aria-label={t.page} className="mt-8 flex flex-wrap items-center justify-center gap-2">
      <PagerLink href={hrefFor(page - 1)} disabled={page <= 1} rel="prev">
        ← {t.previousPage}
      </PagerLink>

      {pageWindow(page, totalPages).map((p, i) =>
        p === null ? (
          <span key={`gap-${i}`} className="px-1 text-sm text-neutral-400">
            …
          </span>
        ) : (
          <PagerLink key={p} href={hrefFor(p)} current={p === page}>
            {p}
          </PagerLink>
        ),
      )}

      <PagerLink href={hrefFor(page + 1)} disabled={page >= totalPages} rel="next">
        {t.nextPage} →
      </PagerLink>
    </nav>
  );
}

/**
 * First and last page always visible, a window around the current one, ellipses for the
 * rest — so the control stays the same size whether there are 3 pages or 300.
 */
export function pageWindow(page: number, totalPages: number, radius = 1): (number | null)[] {
  const wanted = new Set<number>([1, totalPages]);
  for (let p = page - radius; p <= page + radius; p += 1) {
    if (p >= 1 && p <= totalPages) wanted.add(p);
  }

  const out: (number | null)[] = [];
  let previous = 0;
  for (const p of [...wanted].sort((a, b) => a - b)) {
    // A single skipped page is not worth an ellipsis — show the page itself.
    if (previous && p - previous > 1) out.push(p - previous === 2 ? p - 1 : null);
    out.push(p);
    previous = p;
  }
  return out;
}

function PagerLink({
  href,
  children,
  current = false,
  disabled = false,
  rel,
}: {
  href: string;
  children: React.ReactNode;
  current?: boolean;
  disabled?: boolean;
  rel?: string;
}) {
  const base = 'rounded-lg border px-3 py-1.5 text-sm tabular-nums transition';

  if (disabled) {
    return (
      <span aria-disabled="true" className={`${base} border-neutral-200 bg-white text-neutral-300`}>
        {children}
      </span>
    );
  }

  return (
    <Link
      href={href}
      rel={rel}
      aria-current={current ? 'page' : undefined}
      className={[
        base,
        'focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
        current
          ? 'border-neutral-900 bg-neutral-900 font-semibold text-white'
          : 'border-neutral-300 bg-white text-neutral-700 hover:border-neutral-900',
      ].join(' ')}
    >
      {children}
    </Link>
  );
}
