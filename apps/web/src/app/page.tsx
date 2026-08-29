import Link from 'next/link';
import { availableSizes } from '@tike/db';
import { SizeGrid } from '@/components/size-grid';
import { t } from '@/lib/messages';
import { getSize } from '@/lib/size';

// Results depend on live stock, so nothing here is prerendered at build time.
export const dynamic = 'force-dynamic';

export default async function Home() {
  const [sizes, selected] = await Promise.all([availableSizes(), getSize()]);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-5 py-16">
      <h1 className="text-4xl font-semibold tracking-tight text-neutral-900 sm:text-5xl">
        {t.tagline}
      </h1>
      <p className="mt-3 text-lg text-neutral-600">{t.intro}</p>

      <section className="mt-10" aria-labelledby="size-heading">
        <h2 id="size-heading" className="mb-3 text-sm font-medium text-neutral-700">
          {t.chooseSize}
        </h2>
        <SizeGrid sizes={sizes} selected={selected} />
      </section>

      <p className="mt-10 text-sm text-neutral-500">
        <Link href="/patike" className="underline underline-offset-4 hover:text-neutral-900">
          {t.allSizes} →
        </Link>
      </p>
    </main>
  );
}
