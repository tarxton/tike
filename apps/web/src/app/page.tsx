import { availableSizes } from '@tike/db';
import { Filters } from '@/components/filters';
import { t } from '@/lib/messages';
import { parseSizes } from '@/lib/sizes';

// Results depend on live stock, so nothing here is prerendered at build time.
export const dynamic = 'force-dynamic';

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const showKids = params.djecije === '1';
  // Ticked only when the URL says so, so arriving at the home page shows the whole
  // catalogue rather than last month's selection.
  const selected = parseSizes(
    Array.isArray(params.velicina) ? params.velicina[0] : params.velicina,
  );
  const sizes = await availableSizes();

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-5 py-16">
      <h1 className="text-4xl font-semibold tracking-tight text-neutral-900 sm:text-5xl">
        {t.tagline}
      </h1>
      <p className="mt-3 text-lg text-neutral-600">{t.intro}</p>

      <section className="mt-10">
        <Filters
          sizes={sizes}
          selected={selected}
          showKids={showKids}
          kidsHref={showKids ? '/' : '/?djecije=1'}
          returnTo="/"
        />
      </section>
    </main>
  );
}
