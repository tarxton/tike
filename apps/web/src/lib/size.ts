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
 * Toggle one size in or out of the selection, persist it, and reload the results.
 * A form action keeps this working without client-side JavaScript.
 */
export async function toggleSize(formData: FormData): Promise<void> {
  const current = parseSizes(String(formData.get('current') ?? ''));
  const toggled = Number(formData.get('toggle'));
  const showKids = formData.get('kids') === '1';

  let next: number[];
  if (!Number.isFinite(toggled)) {
    next = []; // "all sizes"
  } else if (current.includes(toggled)) {
    next = current.filter((s) => s !== toggled);
  } else {
    next = [...current, toggled].sort((a, b) => a - b);
  }

  const jar = await cookies();
  if (next.length > 0) {
    jar.set(COOKIE, next.join(','), { maxAge: ONE_YEAR, sameSite: 'lax', path: '/' });
  } else {
    jar.delete(COOKIE);
  }

  const params = new URLSearchParams();
  if (next.length > 0) params.set('velicina', next.join(','));
  if (showKids) params.set('djecije', '1');
  const qs = params.toString();
  redirect(qs ? `/patike?${qs}` : '/patike');
}
