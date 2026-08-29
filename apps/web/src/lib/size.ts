'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { parseSizes } from './sizes';

const COOKIE = 'tike_sizes';
const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * The selection lives in a cookie rather than client state so the server renders
 * already-filtered results on the first paint. Size-first is the product thesis;
 * making the user wait for a client round trip to apply it would undercut that.
 *
 * Multiple sizes are supported because plenty of people fit two — 45 and 46 both
 * work, and they want to see either.
 */
export async function getSizes(): Promise<number[]> {
  return parseSizes((await cookies()).get(COOKIE)?.value);
}

/**
 * Apply the whole filter form at once: the typed query and every ticked size.
 *
 * Sizes and the search box live in one form on purpose. When they were separate,
 * clicking a size submitted the size form and threw away text the user had already
 * typed — so "dunk" plus size 44 searched only for size 44.
 */
export async function applyFilters(formData: FormData): Promise<void> {
  const sizes = parseSizes(formData.getAll('velicina').join(','));
  const query = String(formData.get('q') ?? '').trim();
  const brand = String(formData.get('brend') ?? '').trim();
  const showKids = formData.get('djecije') === '1';

  const jar = await cookies();
  if (sizes.length > 0) {
    jar.set(COOKIE, sizes.join(','), { maxAge: ONE_YEAR, sameSite: 'lax', path: '/' });
  } else {
    jar.delete(COOKIE);
  }

  const params = new URLSearchParams();
  if (sizes.length > 0) params.set('velicina', sizes.join(','));
  if (query) params.set('q', query);
  if (brand) params.set('brend', brand);
  if (showKids) params.set('djecije', '1');

  const qs = params.toString();
  redirect(qs ? `/patike?${qs}` : '/patike');
}
