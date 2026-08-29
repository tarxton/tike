import Link from 'next/link';
import { availableSizes } from '@tike/db';
import { Filters } from '@/components/filters';
import { t } from '@/lib/messages';
import { getSizes } from '@/lib/size';

// Results depend on live stock, so nothing here is prerendered at build time.
export const dynamic = 'force-dynamic';

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const showKids = params.djecije === '1';
  const [sizes, selected] = await Promise.all([availableSizes(), getSizes()]);

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
        />
      </section>

      <p className="mt-10 text-sm text-neutral-500">
        <Link href="/patike" className="underline underline-offset-4 hover:text-neutral-900">
          {t.allSizes} →
        </Link>
      </p>
    </main>
  );
}
