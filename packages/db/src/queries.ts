import { sql, type SQL } from 'drizzle-orm';
import { db } from './client';

/**
 * Read queries for the site.
 *
 * Everything the UI needs goes through here, so the eventual switch from per-shop
 * offers to canonical products touches this file and nothing else. Today a "result"
 * is one shop's listing; once matching lands it becomes one shoe with several shops
 * attached, and the shape below already carries `shopCount` to absorb that.
 *
 * Uses the HTTP driver (read path, ADR-0001).
 */

export interface SearchResult {
  offerId: number;
  shopSlug: string;
  shopName: string;
  /** The product's canonical name, so a card and its product page agree. */
  title: string;
  brand: string | null;
  url: string;
  imageUrl: string | null;
  priceMinor: number;
  /** The pre-sale price when the shop is discounting, otherwise null. */
  originalPriceMinor: number | null;
  /** Whole-percent saving, e.g. 30 for -30%. Null when not on sale. */
  discountPercent: number | null;
  currency: string;
  /** In-stock EU sizes for this listing, ascending. */
  sizesEu: number[];
  /** The dearest shop's price for the same shoe; equals priceMinor for one listing. */
  maxPriceMinor: number;
  /** How many shops carry this shoe. 1 for an unmatched listing. */
  shopCount: number;
  /** Null while the listing is unmatched, so the card is really just one shop's offer. */
  productId: number | null;
  /** The product page's slug, when this result is a matched shoe rather than one offer. */
  productSlug: string | null;
  /**
   * Every shop in the group, cheapest first.
   *
   * "2 prodavnice" tells a shopper how many but not which, and which is what decides
   * whether the card is worth a click — someone who trusts one retailer and not another
   * should be able to see that without opening the page.
   */
  shops: { slug: string; name: string; logoUrl: string | null }[];
}

/**
 * One page of results plus the size of the whole matching set.
 *
 * `total` is not `items.length`: the query is limited, so the two differ as soon as
 * there are more matches than fit on a page. Reporting `items.length` as the result
 * count told the user "48 rezultata" while the brand facet beside it said "Nike 73".
 */
export interface SearchPage {
  items: SearchResult[];
  /** Matching offers across every page, ignoring limit/offset. */
  total: number;
}

/**
 * How results are ordered. The URL carries these verbatim, so they are in BCS.
 *
 * `undefined` means "decide from context": relevance when there is a query to be relevant
 * to, newest when browsing. A flat default cannot serve both — making newest unconditional
 * would sort a search for "cortez" by discovery date and bury the shoe that was asked for.
 */
export type SortKey = 'najnovije' | 'najjeftinije' | 'najskuplje' | 'snizenje' | 'abecedno';

export const SORT_KEYS: SortKey[] = [
  'najnovije',
  'najjeftinije',
  'najskuplje',
  'snizenje',
  'abecedno',
];

export function isSortKey(value: string | undefined): value is SortKey {
  return value !== undefined && (SORT_KEYS as string[]).includes(value);
}

export interface SearchParams {
  /**
   * Hard filter: only listings a shop can sell today in at least one of these EU sizes.
   *
   * Multiple sizes are the common case, not an edge case — plenty of people fit both
   * 45 and 46 and want to see either.
   */
  sizesEu?: number[];
  /**
   * Brand names to include. Empty means every brand.
   *
   * Several rather than one because the question is usually "Nike or adidas, in my
   * size" — a shopper comparing two brands had to run two searches and hold the
   * cheaper result in their head.
   */
  brands?: string[];
  /**
   * One model family, as picked from the dropdown. See `familyKey`.
   *
   * Narrows to every colourway of that model — the colour picker a shopper needs after
   * naming the shoe. Only matched offers can carry a family, which is all of them.
   */
  modelKey?: string;
  /**
   * Match titles by trigram closeness instead of by substring.
   *
   * Only used as a second attempt after an exact search returned nothing, so a query
   * that works normally is never diluted by near-misses.
   */
  fuzzy?: boolean;
  /**
   * One product to leave out — the shoe whose page is asking.
   *
   * Without it a product page's "other colourways" shelf would lead with the colourway
   * already filling the screen above it.
   */
  excludeProductId?: number;
  query?: string;
  /**
   * Include listings that only come in children's sizes.
   *
   * Off by default. Results are ordered by price, and children's shoes are structurally
   * cheaper, so including them turns an unfiltered search into a wall of kids' shoes
   * before an adult sees a single relevant result.
   */
  includeKids?: boolean;
  /**
   * Only listings the shop is discounting.
   *
   * "Discounting" means the old price is genuinely higher, not merely present — shops
   * repeat the current price in the old-price field often enough that trusting its
   * presence would put the whole catalogue on sale.
   */
  onSale?: boolean;
  /** Shop slugs to include. Empty means every shop. */
  shops?: string[];
  /**
   * Genders to include, as extracted from each shop's own words.
   *
   * Around a third of the catalogue still says nothing about who a shoe is for, and
   * those are included in every selection rather than hidden. Size ranges cannot fill
   * the gap: measured against known labels, they put over half of children's shoes in
   * women's, because junior 36-40 and women's 36-40 are the same numbers.
   */
  genders?: string[];
  sort?: SortKey;
  limit?: number;
  offset?: number;
}

/** Sizes below this are children's; mirrors ADULT_MIN_SIZE in the web app. */
const ADULT_MIN_SIZE = 36;

/** Excludes listings whose entire in-stock range is children's sizes. */
function kidsFilter(includeKids: boolean | undefined) {
  if (includeKids) return sql``;
  return sql`and exists (
    select 1 from offer_size k
    where k.offer_id = o.id and k.in_stock and k.size_eu >= ${ADULT_MIN_SIZE}
  )`;
}

/**
 * The title reduced to letters and digits, for matching only.
 *
 * Punctuation inside a model name is the shop's typography, not part of what the shopper
 * is looking for: "p6000" and "p-6000" are the same request, and 235 titles in the
 * catalogue carry an intra-word hyphen or dot (Gel-NYC, XT-6, Hoops 4.0). Folding both
 * sides means the search box stops caring.
 */
const foldedTitle = sql`regexp_replace(unaccent(lower(o.title)), '[^a-z0-9]', '', 'g')`;

/**
 * Every word of the query must appear in the folded title.
 *
 * Words rather than the whole string, because shops interleave their own: Buzz writes
 * "Nike Patike NIKE P-6000", so a contiguous match on "nike p-6000" found 5 of the 20
 * listings that are plainly that shoe. The tokens are folded by the same SQL expression
 * as the title, so the two can never drift apart.
 */
function titleFilter(query: string | undefined) {
  const tokens = (query ?? '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return sql``;
  return sql.join(
    tokens.map(
      (t) =>
        sql`and ${foldedTitle} like '%' || regexp_replace(unaccent(lower(${t})), '[^a-z0-9]', '', 'g') || '%'`,
    ),
    sql` `,
  );
}

/**
 * A model family, as a URL-safe key: "nike-air-force-1-07".
 *
 * `product` is one colourway, not one model — 7,235 products against 7,846 in-stock
 * offers — so a suggestion list built on products would offer "AIR FORCE 1 '07" as
 * twenty-four separate rows. Families group them.
 *
 * The key folds punctuation away because shops do not agree on it: one Nike splits into
 * three families on the apostrophe alone (`'07`, `‘07`, `’07`), and Asics splits on `®`,
 * `™` and a non-breaking hyphen. Folding merged 2,899 raw pairs into 2,851 real ones.
 *
 * Defined once and used both to generate keys and to filter by them, so a key the
 * dropdown emits always matches the rows the results page then selects. Expects `p`
 * (product) and `b` (brand) in scope.
 */
const familyKey = sql`btrim(regexp_replace(unaccent(lower(coalesce(b.name, '') || ' ' || p.model)), '[^a-z0-9]+', '-', 'g'), '-')`;

/** The same text with spaces kept, for trigram scoring. */
const familyText = sql`btrim(regexp_replace(unaccent(lower(coalesce(b.name, '') || ' ' || p.model)), '[^a-z0-9]+', ' ', 'g'))`;

/** And with everything stripped, for punctuation-proof token matching. */
const foldedFamily = sql`regexp_replace(unaccent(lower(coalesce(b.name, '') || ' ' || p.model)), '[^a-z0-9]', '', 'g')`;

/** One row of the model dropdown. */
export interface ModelSuggestion {
  /** Stable id for `?model=`, produced by the same SQL that filters on it. */
  key: string;
  brand: string | null;
  /** The cleanest spelling in the family — the one carrying fewest symbols. */
  model: string;
  /** How many colourways sit behind this row. */
  colourways: number;
  /** Shops carrying any colourway in the family, for a "u N prodavnica" hint. */
  shopCount: number;
}

/**
 * Models matching what the user has typed so far, best first.
 *
 * Deliberately ignores the size filter. The dropdown answers "which shoe do you mean",
 * the size filter answers "which of these can I buy" — and hiding a model because it is
 * not in stock in your size today is a false negative, since stock is hours old and the
 * product page can say honestly which shops have your size and which do not.
 */
export async function modelSuggestions(
  query: string | undefined,
  limit = 8,
  fuzzy = false,
): Promise<ModelSuggestion[]> {
  const tokens = (query ?? '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const normalized = tokens.join(' ');
  const rows = await db().execute(sql`
    select
      ${familyKey}                                              as "key",
      min(b.name)                                               as "brand",
      -- Within a family the spellings differ only in punctuation and trademark symbols,
      -- so the shortest is the cleanest: "GEL-KAYANO 32" over "gel‑kayano™ 32".
      (array_agg(p.model order by length(p.model), p.model))[1] as "model",
      count(distinct p.id)::int                                 as "colourways",
      count(distinct o.shop_id)::int                            as "shop_count",
      max(similarity(${familyText}, ${normalized}))             as "score"
    from product p
    left join brand b on b.id = p.brand_id
    join offer o on o.product_id = p.id and o.in_stock
    join shop s on s.id = o.shop_id and s.active
    where p.model <> ''
      ${
        fuzzy
          ? sql`and word_similarity(${normalized}, ${familyText}) >= ${FUZZY_THRESHOLD}`
          : sql.join(
              tokens.map(
                (t) =>
                  sql`and ${foldedFamily} like '%' || regexp_replace(unaccent(lower(${t})), '[^a-z0-9]', '', 'g') || '%'`,
              ),
              sql` `,
            )
      }
    group by ${familyKey}
    -- Score first, then the bigger family: with two equally good matches, the model
    -- carrying more colourways is the one more people mean.
    order by "score" desc, "colourways" desc, "model" asc
    limit ${limit}
  `);

  return (rows.rows as Record<string, unknown>[]).map((r) => ({
    key: String(r.key),
    brand: r.brand === null ? null : String(r.brand),
    model: String(r.model),
    colourways: Number(r.colourways),
    shopCount: Number(r.shop_count),
  }));
}

/**
 * The name behind a `?model=` key, for showing what is filtered and offering to clear it.
 *
 * Resolved rather than carried in the URL: a label in the query string is one the user
 * can edit, and a results page insisting it is showing "Air Force 1" when it is not
 * would be worse than no label at all.
 */
export async function modelByKey(
  key: string | undefined,
): Promise<{ brand: string | null; model: string } | null> {
  if (!key) return null;
  const rows = await db().execute(sql`
    select
      min(b.name)                                               as "brand",
      (array_agg(p.model order by length(p.model), p.model))[1] as "model"
    from product p
    left join brand b on b.id = p.brand_id
    where ${familyKey} = ${key}
    group by ${familyKey}
    limit 1
  `);
  const first = (rows.rows as Record<string, unknown>[])[0];
  if (!first) return null;
  return {
    brand: first.brand === null ? null : String(first.brand),
    model: String(first.model),
  };
}

/**
 * Record a search that found nothing.
 *
 * The single most useful number this site can collect about itself: it says either that
 * the catalogue is missing something people want, or that the search cannot find what it
 * already has. Both are actionable, and neither is visible from click logs.
 *
 * A write on the read client, deliberately. One INSERT needs no transaction, so the
 * HTTP driver's inability to run them (ADR-0001) does not apply, and opening a WebSocket
 * pool to record a log line would cost more than the query that missed.
 *
 * Never throws. A failed log must not turn an empty result page into an error page.
 */
export async function logSearchMiss(params: {
  query: string;
  sizesEu?: number[];
  filters?: Record<string, unknown>;
}): Promise<void> {
  // Truncated rather than rejected: a 4KB query string is still evidence of something,
  // and the column should not carry someone's paste of a novel.
  const query = params.query.trim().slice(0, 200);
  const sizes = params.sizesEu ?? [];
  const primarySize = sizes.length > 0 ? sizes[0]! : null;
  const filters = { ...(params.filters ?? {}), sizes };

  try {
    await db().execute(sql`
      insert into search_miss (query, size_eu, filters)
      values (${query}, ${primarySize}, ${JSON.stringify(filters)}::jsonb)
    `);
  } catch {
    // Swallowed on purpose. See above.
  }
}

/**
 * How close a typo has to be before it counts as the same word.
 *
 * Measured against the live catalogue rather than picked: at 0.45 "samaba" returned one
 * row and none of the 42 adidas Samba listings; at 0.40 it returns 43 rows of which 42
 * are Samba. Every other case tested — asixs, sketchers, jordn, dunkk, cortz — scores
 * identically at 0.40 and 0.50, and nonsense ("zxcvbn", "qqqq") returns nothing at any
 * of them. So 0.40 is strictly better on this data, not a loosening.
 *
 * It only ever runs after an exact search has already returned nothing, which is what
 * makes a low bar the right call: the alternative on offer is an empty page.
 */
const FUZZY_THRESHOLD = 0.4;

/**
 * The public URL of our stored copy of an offer's image, or null.
 *
 * A correlated lookup rather than a join, so it can be dropped into an existing select
 * list without changing the shape of the query around it. `image_cache.source_url` is the
 * primary key, so each one is a single index probe.
 *
 * Rows with an `error` are deliberately excluded: a recorded failure means there is no
 * object to serve, and the shop's own URL is still the best thing to try.
 */
const R2_PUBLIC_BASE = (process.env.R2_PUBLIC_BASE_URL ?? '').replace(/\/$/, '');

/**
 * Takes the source column rather than assuming one.
 *
 * It used to be a constant bound to `o.image_url`, which meant the product page's own
 * `p.hero_image_url` had no lookup at all and was served straight from the retailer. Đak
 * hotlink-protects its images — a foreign referer gets a 403, which is exactly what a
 * browser sends — so every Đak product page rendered a broken hero while the colourway
 * cards below it, which go through the search query, were fine.
 */
const cachedImageUrl = (source: SQL) =>
  R2_PUBLIC_BASE
    ? sql`(
      select ${R2_PUBLIC_BASE} || '/' || c.key
      from image_cache c
      where c.source_url = ${source} and c.error is null
    )`
    : // Nothing stored anywhere yet, so every image is the shop's own. Written as a literal
      // null so the coalesce around it still type-checks and the query plan is unchanged.
      sql`null`;

/** The title folded to letters, digits and spaces — what trigram matching compares. */
const spacedTitle = sql`regexp_replace(unaccent(lower(o.title)), '[^a-z0-9 ]', ' ', 'g')`;

/**
 * Titles close enough to the query to be what the user meant.
 *
 * `word_similarity` rather than `similarity`, because it scores the best-matching run of
 * words inside the title instead of the title as a whole: "cortz" against "Nike Patike
 * Cortez" should be judged on "cortez", not diluted by the two words around it.
 */
function fuzzyTitleFilter(query: string | undefined) {
  const trimmed = query?.trim();
  if (!trimmed) return sql``;
  return sql`and word_similarity(
    regexp_replace(unaccent(lower(${trimmed})), '[^a-z0-9 ]', ' ', 'g'),
    ${spacedTitle}
  ) >= ${FUZZY_THRESHOLD}`;
}

/**
 * What a result is called, for scoring only: the product's brand and model where matching
 * has named it, the shop's own title where it has not.
 *
 * It used to be the cheapest shop's title, and that was the wrong thing to score. Shops
 * write the same shoe very differently — Đak's "ADIDAS PATIKE SAMBA ZA MUŠKARCE" against
 * Buzz's "adidas Samba" — so a plain Samba that happened to be cheapest at Đak scored as a
 * worse match for "samba" than a cleanly titled Samba OG. The results read Samba ×13, then
 * the variations, then more plain Sambas from position 26. The canonical name is the same
 * string whichever shop is cheapest.
 *
 * The category word is still stripped from the fallback: Buzz prefixes "Patike" to every
 * title, which would otherwise rank its unmatched listings below everyone else's.
 */
const scoredName = sql`btrim(replace(' ' || regexp_replace(unaccent(lower(
  coalesce(nullif(btrim(coalesce(pb.name, '') || ' ' || coalesce(pr.model, '')), ''), b.title)
)), '[^a-z0-9 ]', '', 'g') || ' ', ' patike ', ' '))`;

/** The same, with every separator gone, for an exact comparison that ignores spacing. */
const exactModel = sql`regexp_replace(unaccent(lower(coalesce(pr.model, ''))), '[^a-z0-9]', '', 'g')`;
const exactBrandModel = sql`regexp_replace(unaccent(lower(coalesce(pb.name, '') || coalesce(pr.model, ''))), '[^a-z0-9]', '', 'g')`;

/**
 * Result order.
 *
 * Cheapest first is the promise of the site, so price leads whenever there is no query
 * to be relevant to. With a query it does not: searching "cortez" and getting fourteen
 * "Cortez TXT" listings before the plain Cortez — because they happen to cost 20 KM
 * less — answers a question nobody asked.
 *
 * Relevance is therefore banded to one decimal rather than used raw: titles of roughly
 * equal relevance stay ordered by price, and only a real difference in relevance
 * outranks a cheaper price.
 *
 * Equal on both, the result covering more shops wins. That is the whole point of the
 * site, and it costs the shopper nothing when the prices are identical anyway.
 *
 * Returns the sort keys without `order by`, because they are used inside a window —
 * `row_number() over (order by …)` — to number the page before anything expensive is
 * computed for it. See the `page` step in `searchOffers`.
 */
function resultOrder(query: string | undefined, sort: SortKey | undefined) {
  const trimmed = query?.trim();
  // Cheapest, then most shops, then a stable key — every sort ends with this so that
  // pagination never reorders rows it has already shown.
  const tail = sql`g.min_price asc, g.shop_count desc, g.group_key asc`;

  if (sort === 'najjeftinije') return tail;
  if (sort === 'najskuplje') return sql`g.min_price desc, g.group_key asc`;
  if (sort === 'abecedno') {
    // By the name the card shows, not the cheapest shop's title: sorting on "ADIDAS
    // PATIKE…" put a card reading "Samba" among the A's. Unaccented, so Č and Ć sort
    // where a BCS reader expects rather than after Z.
    return sql`unaccent(lower(coalesce(pr.model, b.title))) asc, ${tail}`;
  }
  if (sort === 'snizenje') {
    // Only 3.7% of the catalogue is discounted, so everything else ties at zero and the
    // tail decides — which is why the tail is cheapest-first rather than arbitrary.
    return sql`g.best_discount desc, ${tail}`;
  }
  if (sort === 'najnovije') return sql`g.first_seen desc, ${tail}`;

  // No explicit choice: be relevant when there is something to be relevant to.
  if (!trimmed) return sql`g.first_seen desc, ${tail}`;
  /*
   * Exact matches first, then everything else by closeness.
   *
   * "samba" should list the shoes called Samba before Samba OG, XLG and LT — the model the
   * shopper typed, and then its variations — and an exact name is a different kind of
   * match from a close one, not just a slightly better score. Compared with separators
   * removed and against both the model and brand + model, so "samba", "adidas samba" and
   * "Samba" all land in the first tier.
   */
  const folded = sql`regexp_replace(unaccent(lower(${trimmed})), '[^a-z0-9]', '', 'g')`;
  return sql`
      case when ${exactModel} = ${folded} or ${exactBrandModel} = ${folded} then 0 else 1 end,
      round(similarity(${scoredName}, regexp_replace(unaccent(lower(${trimmed})), '[^a-z0-9 ]', '', 'g'))::numeric, 1) desc,
      ${tail}`;
}

/** Listings whose old price is genuinely higher than what they cost today. */
function saleFilter(onSale: boolean | undefined) {
  if (!onSale) return sql``;
  return sql`and o.original_price_minor is not null and o.original_price_minor > o.price_minor`;
}

/** `s.slug in ('buzz', 'officeshoes')`, or nothing when no shop is chosen. */
function shopFilter(shops: string[] | undefined) {
  if (!shops || shops.length === 0) return sql``;
  const list = sql.join(
    shops.map((slug) => sql`${slug}`),
    sql`, `,
  );
  return sql`and s.slug in (${list})`;
}

/**
 * `unaccent(lower(raw_brand)) in (...)`, folded on both sides.
 *
 * Folding is not decoration here: shops write the same brand differently, and a chip
 * built from one shop's spelling must still select the other's.
 */
function brandFilter(brands: string[] | undefined) {
  if (!brands || brands.length === 0) return sql``;
  const list = sql.join(
    brands.map((b) => sql`unaccent(lower(${b}))`),
    sql`, `,
  );
  return sql`and unaccent(lower(o.raw_brand)) in (${list})`;
}

/**
 * Narrow to one model family.
 *
 * Matched through `product` rather than the offer title, because the family is a
 * property of the canonical shoe: two shops title the same model differently, and
 * matching on their words would drop whichever one phrased it unusually.
 */
function modelFilter(modelKey: string | undefined) {
  if (!modelKey) return sql``;
  return sql`and o.product_id in (
    select p.id from product p
    left join brand b on b.id = p.brand_id
    where ${familyKey} = ${modelKey}
  )`;
}

/**
 * `o.gender in (...)`, and always the unlabelled ones too.
 *
 * Excluding nulls would quietly hide a third of the catalogue behind a filter that
 * claims only to narrow by gender. A shopper who picks "muške" would rather see a few
 * unlabelled shoes than silently lose two thousand.
 */
function genderFilter(genders: string[] | undefined) {
  if (!genders || genders.length === 0) return sql``;
  const list = sql.join(
    genders.map((g) => sql`${g}`),
    sql`, `,
  );
  return sql`and (o.gender is null or o.gender::text in (${list}))`;
}

/** Offers stocking any selected size (a whole size with its halves and thirds), or nothing. */
function sizeFilter(sizesEu: number[] | undefined) {
  if (!sizesEu || sizesEu.length === 0) return sql``;
  /*
   * A whole size brings its halves and thirds with it; a half or a third means itself.
   *
   * Someone who picks 44 wears a 44, but adidas sizes in thirds and plenty of shoes come in
   * 44⅔ and never in a plain 44 — the size that fits a 44 foot in that brand. Matching only
   * 44 hid those shoes entirely, so a search for someone's size quietly missed the pair
   * they would have bought. The card marks such a size differently from an exact one, so
   * nothing claims to be what it is not. Picking 44½ itself is a deliberate choice and
   * stays exact.
   */
  const clauses = sql.join(
    sizesEu.map((s) =>
      Number.isInteger(s)
        ? sql`(f.size_eu >= ${s} and f.size_eu < ${s + 1})`
        : sql`f.size_eu = ${s}`,
    ),
    sql` or `,
  );
  return sql`and exists (
    select 1 from offer_size f
    where f.offer_id = o.id and f.in_stock and (${clauses})
  )`;
}

/**
 * Text matching folds diacritics on both sides, so `muske` matches `muške`.
 *
 * `unaccent()` is not indexable without a materialized column, which is fine at this
 * catalogue size (thousands of rows). When it stops being fine, the fix is a stored
 * normalized column with the trigram index that migration 0001 already prepares.
 */
export async function searchOffers(params: SearchParams = {}): Promise<SearchPage> {
  const {
    sizesEu,
    brands,
    modelKey,
    fuzzy,
    excludeProductId,
    query,
    includeKids,
    onSale,
    shops,
    genders,
    sort,
    limit = 48,
    offset = 0,
  } = params;
  // An explicitly chosen children's size is a deliberate request for them, and so is
  // filtering to children's shoes — without this the gender filter subtracted 861 of the
  // kids products it was asked to show, because the default still excluded anything whose
  // whole size run is under EU 36.
  const wantsKids =
    includeKids ||
    (sizesEu ?? []).some((s) => s < ADULT_MIN_SIZE) ||
    (genders ?? []).includes('kids');

  const rows = await db().execute(sql`
    -- Filter at the offer level first: a size or brand filter is a statement about a
    -- shop's listing, and grouping before filtering would let one shop's stock vouch
    -- for another's.
    with candidate as (
      select
        o.id, o.shop_id, o.product_id, o.title, o.raw_brand, o.url,
        -- Our stored copy when there is one, the shop's URL when there is not.
        -- Coalesced here rather than in the app so every reader gets it: a card that
        -- hotlinks is a request on a retailer's server per page view, and for Djak, whose
        -- images are served only to its own pages, it is a broken image.
        coalesce(${cachedImageUrl(sql`o.image_url`)}, o.image_url) as image_url,
        o.price_minor, o.original_price_minor, o.currency, o.first_seen_at,
        s.slug as shop_slug, s.name as shop_name, s.logo_url as shop_logo,
        -- Matched offers collapse onto their product; unmatched ones stay their own
        -- group, so nothing disappears from the results while coverage is partial.
        coalesce('p' || o.product_id::text, 'o' || o.id::text) as group_key
      from offer o
      join shop s on s.id = o.shop_id
      where s.active
        and o.in_stock
        ${sizeFilter(sizesEu)}
        ${kidsFilter(wantsKids)}
        ${saleFilter(onSale)}
        ${shopFilter(shops)}
        ${genderFilter(genders)}
        ${brandFilter(brands)}
        ${modelFilter(modelKey)}
        ${excludeProductId === undefined ? sql`` : sql`and (o.product_id is null or o.product_id <> ${excludeProductId})`}
        ${fuzzy ? fuzzyTitleFilter(query) : titleFilter(query)}
    ),
    grouped as (
      select
        group_key,
        min(price_minor) as min_price,
        -- The other end of the range. A card that says "2 shops" has to be able to say
        -- what the second one charges, or the number is just decoration.
        max(price_minor) as max_price,
        count(distinct shop_id)::int as shop_count,
        -- When tike first saw this shoe anywhere, not when a shop last restocked it.
        min(first_seen_at) as first_seen,
        -- The best saving any shop is offering on it, as a fraction.
        max(
          case
            when original_price_minor > price_minor
              then (original_price_minor - price_minor)::numeric / original_price_minor
            else 0
          end
        ) as best_discount,
        -- The cheapest offer represents the group: it supplies the image, title and
        -- the link, so "od 215 KM" and the click-out always agree.
        (array_agg(id order by price_minor asc, id asc))[1] as best_offer_id
      from candidate
      group by group_key
    ),
    /*
     * The page, chosen before anything expensive is built for it.
     *
     * The size list and the shop list below each read every candidate offer. They used to
     * be subqueries in the final select, and Postgres evaluates a select list for every
     * row it passes on the way to the offset, not only for the rows it returns — so page
     * one cost 48 of each and the last page cost 6.240. Measured: 0,4s for page one, 5,7s
     * for page 51, 14,4s for page 130, and page 130 is not obscure, it is the "last page"
     * link the pager always shows.
     *
     * Numbering the rows with a window instead of sorting the final select keeps the order
     * identical to what it was, and lets the result come back in that order after the
     * lists are joined on. The total is counted here too, over every group, so it still
     * does not depend on which page was asked for.
     */
    page as (
      select
        g.group_key, g.min_price, g.max_price, g.shop_count, g.best_offer_id,
        count(*) over () as total,
        row_number() over (order by ${resultOrder(query, sort)}) as position
      from grouped g
      join candidate b on b.id = g.best_offer_id
      -- The product's own name, for ordering by relevance. See scoredName.
      left join product pr on pr.id = b.product_id
      left join brand pb on pb.id = pr.brand_id
      order by position
      limit ${limit} offset ${offset}
    ),
    -- Sizes are the union across the group: a shoe is available in 44 if any shop in the
    -- group has 44, which is the whole point of comparing shops. One pass over the page's
    -- offers, not one per result.
    page_sizes as (
      select c.group_key, json_agg(distinct f.size_eu order by f.size_eu) as sizes
      from page pg
      join candidate c on c.group_key = pg.group_key
      join offer_size f on f.offer_id = c.id and f.in_stock
      group by c.group_key
    ),
    -- The shops behind the count, cheapest first, so a card can show whose prices these are
    -- rather than only how many there are. Slug breaks a tie, so two shops at one price
    -- come back in the same order every time rather than whichever the planner met first.
    page_shops as (
      select
        x.group_key,
        json_agg(
          json_build_object('slug', x.slug, 'name', x.name, 'logoUrl', x.logo)
          order by x.price, x.slug
        ) as shops
      from (
        select c.group_key, c.shop_slug as slug, c.shop_name as name, c.shop_logo as logo,
               min(c.price_minor) as price
        from page pg
        join candidate c on c.group_key = pg.group_key
        group by 1, 2, 3, 4
      ) x
      group by x.group_key
    )
    select
      b.id            as "offerId",
      b.product_id    as "productId",
      pr.slug         as "productSlug",
      s.slug          as "shopSlug",
      s.name          as "shopName",
      -- The product's name, not the cheapest shop's title.
      --
      -- The card used to show whatever the offer behind best_offer_id was called, and
      -- that offer is picked by price — so on 1.763 cards, 327 of them multi-shop, the
      -- name came from Đak, who writes "NIKE PATIKE AIR PRESTO ZA MUŠKARCE" where Buzz
      -- writes "Air Presto". The shop with the best price decided what the shoe was
      -- called. One product now has one name wherever it appears, and it is the same
      -- string the product page shows.
      coalesce(pr.model, b.title) as "title",
      coalesce(pb.name, b.raw_brand) as "brand",
      b.url           as "url",
      b.image_url     as "imageUrl",
      pg.min_price    as "priceMinor",
      pg.max_price    as "maxPriceMinor",
      b.original_price_minor as "originalPriceMinor",
      b.currency::text as "currency",
      pg.shop_count   as "shopCount",
      -- json_agg, not array_agg: the HTTP driver hands back Postgres arrays as the raw
      -- string "{40.00,41.00}", whereas JSON arrives as a real array.
      coalesce(ps.sizes, '[]'::json) as "sizesEu",
      coalesce(sh.shops, '[]'::json) as "shops",
      -- Total across every page, in the same round trip. A separate count query would
      -- double the latency and could disagree with the page under concurrent writes.
      pg.total        as "totalCount"
    from page pg
    join candidate b on b.id = pg.best_offer_id
    join shop s on s.id = b.shop_id
    left join page_sizes ps on ps.group_key = pg.group_key
    left join page_shops sh on sh.group_key = pg.group_key
    -- Only matched results have a product page to link to.
    left join product pr on pr.id = b.product_id
    left join brand pb on pb.id = pr.brand_id
    order by pg.position
  `);

  const raw = rows.rows as Record<string, unknown>[];
  const items = raw.map((r) => {
    const priceMinor = Number(r.priceMinor);
    const originalPriceMinor = r.originalPriceMinor === null ? null : Number(r.originalPriceMinor);
    // Only treat it as a sale when the old price is genuinely higher; shops sometimes
    // repeat the current price in the "old price" field.
    const onSale = originalPriceMinor !== null && originalPriceMinor > priceMinor;
    return {
      offerId: Number(r.offerId),
      productId: r.productId === null ? null : Number(r.productId),
      productSlug: r.productSlug === null ? null : String(r.productSlug),
      shops: Array.isArray(r.shops)
        ? (r.shops as { slug: string; name: string; logoUrl: string | null }[]).map((x) => ({
            slug: String(x.slug),
            name: String(x.name),
            logoUrl: x.logoUrl === null ? null : String(x.logoUrl),
          }))
        : [],
      shopSlug: String(r.shopSlug),
      shopName: String(r.shopName),
      title: String(r.title),
      brand: r.brand === null ? null : String(r.brand),
      url: String(r.url),
      imageUrl: r.imageUrl === null ? null : String(r.imageUrl),
      priceMinor,
      maxPriceMinor: Number(r.maxPriceMinor),
      originalPriceMinor: onSale ? originalPriceMinor : null,
      discountPercent: onSale
        ? Math.round(((originalPriceMinor - priceMinor) / originalPriceMinor) * 100)
        : null,
      currency: String(r.currency),
      sizesEu: Array.isArray(r.sizesEu) ? r.sizesEu.map(Number) : [],
      shopCount: Number(r.shopCount),
    };
  });

  // No rows means no window to count over, so the total is genuinely zero.
  const first = raw[0];
  return { items, total: first === undefined ? 0 : Number(first.totalCount) };
}

/**
 * EU sizes that some shop currently has in stock — used to build the size picker,
 * so a user is never offered a number that returns nothing.
 *
 * The offer has to be in stock as well as the size. A withdrawn offer keeps its size rows
 * as they were last read, so without it a shoe taken off the site could still hold a size
 * open in the picker that the results then could not deliver.
 */
export async function availableSizes(): Promise<number[]> {
  const rows = await db().execute(sql`
    select distinct sz.size_eu as "sizeEu"
    from offer_size sz
    join offer o on o.id = sz.offer_id
    join shop s on s.id = o.shop_id
    where sz.in_stock and o.in_stock and s.active
    order by sz.size_eu
  `);
  return (rows.rows as Record<string, unknown>[]).map((r) => Number(r.sizeEu));
}

/**
 * Brands in the in-stock catalogue, most listings first.
 *
 * Counts respect the active size filter: with EU 44 selected, "Nike 14" must mean
 * fourteen Nikes available in 44, not fourteen Nikes in the catalogue. A facet count
 * that ignores the current filter promises results the click cannot deliver.
 *
 * The brand selection is the one filter deliberately left out. Brands are OR-ed, so
 * "Puma 120" answers "how many more if I add Puma" — applying the selection to its own
 * facet would zero every brand the user has not already picked, and a filter that
 * erases its own remaining options cannot be widened.
 */
export async function availableBrands(
  params: {
    sizesEu?: number[];
    modelKey?: string;
    query?: string;
    includeKids?: boolean;
    onSale?: boolean;
    shops?: string[];
    genders?: string[];
  } = {},
): Promise<{ brand: string; count: number }[]> {
  const { sizesEu, modelKey, query, includeKids, onSale, shops, genders } = params;
  const wantsKids =
    includeKids ||
    (sizesEu ?? []).some((s) => s < ADULT_MIN_SIZE) ||
    (genders ?? []).includes('kids');
  const rows = await db().execute(sql`
    -- One chip per brand, not one per spelling of it.
    --
    -- Shops disagree about capitals: Đak and The Spot write NIKE, ADIDAS and PEPE JEANS
    -- where the others write Nike, adidas and Pepe Jeans, and grouping on the raw string
    -- put both in the filter — "NIKE 251" beside "Nike 1.970", two chips that select the
    -- same offers because the filter itself has always been case-insensitive. Grouping
    -- folds case and accents; the label is the least shouty spelling, which is also how
    -- each brand writes its own name.
    --
    -- Chosen across the whole catalogue, not within the filtered results. Picking it from
    -- the same rows the facet counts meant that filtering to a shop which writes in
    -- capitals turned every chip into capitals — "PEPE JEANS", "REPLAY", "ON" — for brands
    -- the rest of the site spells normally, and the chip changed its name depending on
    -- which shop was ticked.
    with label as (
      select unaccent(lower(o.raw_brand)) as key,
             (array_agg(o.raw_brand order by (o.raw_brand = upper(o.raw_brand)), o.raw_brand))[1]
               as name
      from offer o
      join shop s on s.id = o.shop_id
      where o.in_stock and s.active and o.raw_brand is not null
      group by 1
    )
    -- Counts groups, not offers, so a facet count matches the result count the header
    -- shows after the same click. Counting rows here would say "Nike 73" and then land
    -- on a page reporting 68.
    select
      l.name as "brand",
      count(distinct coalesce('p' || o.product_id::text, 'o' || o.id::text))::int as "count"
    from offer o
    join shop s on s.id = o.shop_id
    join label l on l.key = unaccent(lower(o.raw_brand))
    where o.in_stock and s.active and o.raw_brand is not null
      ${sizeFilter(sizesEu)}
      ${kidsFilter(wantsKids)}
      ${saleFilter(onSale)}
      ${shopFilter(shops)}
      ${genderFilter(genders)}
      ${modelFilter(modelKey)}
      ${titleFilter(query)}
    group by l.name
    order by 2 desc, 1 asc
  `);
  return (rows.rows as Record<string, unknown>[]).map((r) => ({
    brand: String(r.brand),
    count: Number(r.count),
  }));
}

/** One shop's listing of a product, as the product page shows it. */
export interface ProductOffer {
  offerId: number;
  shopSlug: string;
  shopName: string;
  shopLogoUrl: string | null;
  /** The shop's own title, which differs from the canonical model and is worth showing. */
  title: string;
  url: string;
  priceMinor: number;
  originalPriceMinor: number | null;
  discountPercent: number | null;
  currency: string;
  /** In-stock EU sizes at this shop, ascending. */
  sizesEu: number[];
  /**
   * When the crawler last read this shop's page for this shoe, as an ISO timestamp.
   *
   * Per offer rather than per product, because shops are crawled at different times — the
   * nightly ones before dawn, the two crawled from a desk in the evening — and a listing a
   * crawl could not confirm keeps its last reading until the staleness rule retires it.
   */
  checkedAt: string;
}

export interface ProductDetail {
  id: number;
  slug: string;
  model: string;
  brand: string | null;
  /** The brand's logo in our bucket; null until the image job has stored one. */
  brandLogoUrl: string | null;
  styleCode: string | null;
  gender: string | null;
  heroImageUrl: string | null;
  /** This shoe's model family, for finding its other colourways. See `familyKey`. */
  familyKey: string;
  /** Cheapest first — the order the page presents them in. */
  offers: ProductOffer[];
}

/**
 * One shoe and every shop that sells it.
 *
 * The whole point of matching, finally rendered: a result card can say "3 prodavnice"
 * only because this page can answer which three and at what price. Out-of-stock offers
 * are left out — a shop that has stopped selling it is not a place to buy it — so a
 * product whose every offer has been retired returns its rows with an empty `offers`.
 */
/**
 * Where a slug that no longer names a product went.
 *
 * Matching merges two products into one when it learns they were always the same shoe,
 * and the losing slug had been public up to that moment. Returning the survivor lets the
 * page answer with a permanent redirect instead of a 404.
 */
export async function productSlugRedirect(slug: string): Promise<string | null> {
  const rows = await db().execute(sql`
    select p.slug as "slug"
    from product_slug_alias a
    join product p on p.id = a.product_id
    where a.slug = ${slug}
    limit 1
  `);
  const row = (rows.rows as { slug: string }[])[0];
  return row ? row.slug : null;
}

export async function productBySlug(slug: string): Promise<ProductDetail | null> {
  const rows = await db().execute(sql`
    select
      p.id              as "id",
      p.slug            as "slug",
      p.model           as "model",
      b.name            as "brand",
      ${R2_PUBLIC_BASE ? sql`${R2_PUBLIC_BASE} || '/' || b.logo_key` : sql`null`}
        as "brandLogoUrl",
      p.style_code      as "styleCode",
      p.gender::text    as "gender",
      coalesce(${cachedImageUrl(sql`p.hero_image_url`)}, p.hero_image_url)
        as "heroImageUrl",
      ${familyKey}      as "familyKey"
    from product p
    left join brand b on b.id = p.brand_id
    where p.slug = ${slug}
    limit 1
  `);

  const head = (rows.rows as Record<string, unknown>[])[0];
  if (!head) return null;

  const offerRows = await db().execute(sql`
    select
      o.id            as "offerId",
      s.slug          as "shopSlug",
      s.name          as "shopName",
      s.logo_url      as "shopLogoUrl",
      o.title         as "title",
      o.url           as "url",
      o.price_minor          as "priceMinor",
      o.original_price_minor as "originalPriceMinor",
      o.currency::text as "currency",
      o.last_seen_at  as "checkedAt",
      coalesce(
        (
          select json_agg(f.size_eu order by f.size_eu)
          from offer_size f
          where f.offer_id = o.id and f.in_stock
        ),
        '[]'::json
      ) as "sizesEu"
    from offer o
    join shop s on s.id = o.shop_id
    where o.product_id = ${Number(head.id)}
      and o.in_stock
      and s.active
    order by o.price_minor asc, s.slug asc
  `);

  const offers = (offerRows.rows as Record<string, unknown>[]).map((r) => {
    const priceMinor = Number(r.priceMinor);
    const originalPriceMinor = r.originalPriceMinor === null ? null : Number(r.originalPriceMinor);
    const onSale = originalPriceMinor !== null && originalPriceMinor > priceMinor;
    return {
      offerId: Number(r.offerId),
      shopSlug: String(r.shopSlug),
      shopName: String(r.shopName),
      shopLogoUrl: r.shopLogoUrl === null ? null : String(r.shopLogoUrl),
      title: String(r.title),
      url: String(r.url),
      priceMinor,
      originalPriceMinor: onSale ? originalPriceMinor : null,
      discountPercent: onSale
        ? Math.round(((originalPriceMinor - priceMinor) / originalPriceMinor) * 100)
        : null,
      currency: String(r.currency),
      sizesEu: Array.isArray(r.sizesEu) ? r.sizesEu.map(Number) : [],
      checkedAt: new Date(r.checkedAt as string | Date).toISOString(),
    };
  });

  return {
    id: Number(head.id),
    slug: String(head.slug),
    model: String(head.model),
    brand: head.brand === null ? null : String(head.brand),
    brandLogoUrl: head.brandLogoUrl === null ? null : String(head.brandLogoUrl),
    styleCode: head.styleCode === null ? null : String(head.styleCode),
    gender: head.gender === null ? null : String(head.gender),
    heroImageUrl: head.heroImageUrl === null ? null : String(head.heroImageUrl),
    familyKey: String(head.familyKey),
    offers,
  };
}

/** Shops with something in stock, for the shop filter. */
export async function availableShops(): Promise<
  { slug: string; name: string; logoUrl: string | null }[]
> {
  const rows = await db().execute(sql`
    select s.slug as "slug", s.name as "name", s.logo_url as "logoUrl"
    from shop s
    where s.active and exists (select 1 from offer o where o.shop_id = s.id and o.in_stock)
    order by s.name asc
  `);
  return (rows.rows as Record<string, unknown>[]).map((r) => ({
    slug: String(r.slug),
    name: String(r.name),
    logoUrl: r.logoUrl === null ? null : String(r.logoUrl),
  }));
}
