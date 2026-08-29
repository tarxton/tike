import Link from 'next/link';
import { formatSize, t } from '@/lib/messages';
import { toggleSize } from '@/lib/size';
import { ADULT_MIN_SIZE } from '@/lib/sizes';

/**
 * Multi-select size picker.
 *
 * Sizes come from what is actually in stock, so no number here returns an empty page.
 * Adult sizes show by default; children's sizes sit behind a toggle rather than
 * padding the grid with 20 buttons most visitors will never want.
 */
export function SizeGrid({
  sizes,
  selected,
  showKids = false,
  kidsHref,
}: {
  sizes: number[];
  selected: number[];
  showKids?: boolean;
  kidsHref: string;
}) {
  const visible = showKids ? sizes : sizes.filter((s) => s >= ADULT_MIN_SIZE);
  const kidsCount = sizes.filter((s) => s < ADULT_MIN_SIZE).length;
  const current = selected.join(',');

  return (
    <div className="space-y-3">
      <form action={toggleSize} className="flex flex-wrap gap-2">
        <input type="hidden" name="current" value={current} />
        <input type="hidden" name="kids" value={showKids ? '1' : '0'} />

        {visible.map((size) => {
          const isSelected = selected.includes(size);
          return (
            <button
              key={size}
              name="toggle"
              value={size}
              type="submit"
              aria-pressed={isSelected}
              className={[
                'min-w-14 rounded-lg border px-3 py-2 text-sm font-medium transition',
                'focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
                isSelected
                  ? 'border-neutral-900 bg-neutral-900 text-white'
                  : 'border-neutral-300 bg-white text-neutral-900 hover:border-neutral-900',
              ].join(' ')}
            >
              {formatSize(size)}
            </button>
          );
        })}

        {selected.length > 0 ? (
          <button
            name="toggle"
            value=""
            type="submit"
            className="min-w-14 rounded-lg border border-dashed border-neutral-300 px-3 py-2 text-sm text-neutral-600 hover:border-neutral-500 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            {t.allSizes}
          </button>
        ) : null}
      </form>

      {kidsCount > 0 ? (
        <Link
          href={kidsHref}
          className="inline-block text-sm text-neutral-600 underline underline-offset-4 hover:text-neutral-900"
        >
          {showKids ? t.hideKids : `${t.showKids} (${kidsCount})`}
        </Link>
      ) : null}

      {selected.length > 1 ? <p className="text-xs text-neutral-500">{t.multiSizeHint}</p> : null}
    </div>
  );
}
