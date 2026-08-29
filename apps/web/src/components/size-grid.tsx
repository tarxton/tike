import { formatSize, t } from '@/lib/messages';
import { setSize } from '@/lib/size';

/**
 * Size picker built from sizes that are actually in stock somewhere, so the user is
 * never offered a number that returns nothing.
 */
export function SizeGrid({ sizes, selected }: { sizes: number[]; selected?: number | null }) {
  return (
    <form action={setSize} className="flex flex-wrap gap-2">
      {sizes.map((size) => {
        const isSelected = selected === size;
        return (
          <button
            key={size}
            name="size"
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
      <button
        name="size"
        value=""
        type="submit"
        className="min-w-14 rounded-lg border border-dashed border-neutral-300 px-3 py-2 text-sm text-neutral-600 hover:border-neutral-500 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
      >
        {t.allSizes}
      </button>
    </form>
  );
}
