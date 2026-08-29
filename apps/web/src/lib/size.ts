'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

const COOKIE = 'tike_size';
const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * The chosen size lives in a cookie rather than client state so the server can render
 * already-filtered results on the first paint. Size-first is the product thesis; making
 * the user wait for a client fetch to apply it would undercut that.
 */
export async function getSize(): Promise<number | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 15 && value <= 52 ? value : null;
}

export async function setSize(formData: FormData): Promise<void> {
  const raw = formData.get('size');
  const value = Number(raw);
  const jar = await cookies();
  if (Number.isFinite(value) && value >= 15 && value <= 52) {
    jar.set(COOKIE, String(value), { maxAge: ONE_YEAR, sameSite: 'lax', path: '/' });
    redirect(`/patike?velicina=${value}`);
  }
  jar.delete(COOKIE);
  redirect('/patike');
}

export async function clearSize(): Promise<void> {
  (await cookies()).delete(COOKIE);
  redirect('/');
}
