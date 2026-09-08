import { modelSuggestions } from '@tike/db';

export const dynamic = 'force-dynamic';

/** Below this the list is noise: two letters already narrow 2,851 families hard. */
const MIN_QUERY = 2;
const MAX_ROWS = 8;

/**
 * Model suggestions for the search box.
 *
 * The only API route on the site, and it exists because a typeahead cannot be server
 * rendered — every other control here is a link or a form post. The page still works
 * with this endpoint unreachable: the input is a plain field in the filter form, so
 * pressing Enter runs the freeform search exactly as before.
 */
export async function GET(request: Request): Promise<Response> {
  const query = new URL(request.url).searchParams.get('q') ?? '';
  if (query.trim().length < MIN_QUERY) return Response.json({ items: [] });

  // Exact first, then trigram distance, so "sketchers" still offers Skechers. Typing is
  // where typos happen, so the dropdown needs this at least as much as the results page.
  let items = await modelSuggestions(query, MAX_ROWS);
  if (items.length === 0) items = await modelSuggestions(query, MAX_ROWS, true);
  return Response.json(
    { items },
    // Suggestions change only when a crawl writes new products, so a short shared cache
    // absorbs the keystroke burst of everyone typing "nike" without going stale.
    { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=60' } },
  );
}
