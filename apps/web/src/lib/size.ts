'use server';

import { redirect } from 'next/navigation';
import { parseSizes } from './sizes';

/**
 * Apply the whole filter form at once: the typed query and every ticked size.
 *
 * Sizes and the search box live in one form on purpose. When they were separate,
 * clicking a size submitted the size form and threw away text the user had already
 * typed — so "dunk" plus size 44 searched only for size 44.
 *
 * The selection goes into the URL and nowhere else. It used to be mirrored into a
 * year-long `tike_sizes` cookie so that the server could render already-filtered results
 * on a first paint — but that also meant every later visit opened pre-filtered to
 * whatever was picked weeks ago, with no visible cause and nothing in the address bar to
 * explain it. Someone who filtered to 44 once saw a permanently smaller catalogue.
 *
 * A URL still renders filtered on the first paint, so nothing was actually bought with
 * that cookie; and it makes the size behave like every other filter here — shareable,
 * back-button-correct, and gone when you leave.
 */
export async function applyFilters(formData: FormData): Promise<void> {
  const sizes = parseSizes(formData.getAll('velicina').join(','));
  const query = String(formData.get('q') ?? '').trim();
  const brand = String(formData.get('brend') ?? '').trim();
  const showKids = formData.get('djecije') === '1';

  const params = new URLSearchParams();
  if (sizes.length > 0) params.set('velicina', sizes.join(','));
  if (query) params.set('q', query);
  if (brand) params.set('brend', brand);
  if (showKids) params.set('djecije', '1');

  const qs = params.toString();
  redirect(qs ? `/patike?${qs}` : '/patike');
}
