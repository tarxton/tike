import { sql } from 'drizzle-orm';
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
  /**
   * Where picking this row goes when it holds exactly one colourway.
   *
   * Half of all families do, and sending those straight to the product page is the
   * whole point of the feature: you picked the shoe, so show its prices. A family with
   * several colourways has no single page to land on and goes to filtered results.
   */
  slug: string | null;
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
      min(p.slug)                                               as "slug",
      count(distinct o.shop_id)::int                            as "shop_count",
      max(similarity(${familyText}, ${normalized}))             as "score"
    from product p
    left join brand b on b.id = p.brand_id
    join offer o on o.product_id = p.id and o.in_stock
    join shop s on s.id = o.shop_id and s.active
    where p.model <> ''
      ${sql.join(
        tokens.map(
          (t) =>
            sql`and ${foldedFamily} like '%' || regexp_replace(unaccent(lower(${t})), '[^a-z0-9]', '', 'g') || '%'`,
        ),
        sql` `,
      )}
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
    // Only a single-colourway family can be sent to a product page; for the rest the
    // slug is one arbitrary member of the group and would be a wrong destination.
    slug: Number(r.colourways) === 1 && r.slug !== null ? String(r.slug) : null,
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
 * The representative title with the category word stripped, for scoring only.
 *
 * Buzz prefixes "Patike" to every title and Sport Vision does not, so scoring the raw
 * title ranks Buzz's whole catalogue below Sport Vision's on any query — a systematic
 * bias with nothing to do with relevance. Space-padded `replace` rather than a regex
 * word boundary, which Postgres would not honour here.
 */
const scoredTitle = sql`btrim(replace(' ' || regexp_replace(unaccent(lower(b.title)), '[^a-z0-9 ]', '', 'g') || ' ', ' patike ', ' '))`;

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
 */
function resultOrder(query: string | undefined, sort: SortKey | undefined) {
  const trimmed = query?.trim();
  // Cheapest, then most shops, then a stable key — every sort ends with this so that
  // pagination never reorders rows it has already shown.
  const tail = sql`g.min_price asc, g.shop_count desc, g.group_key asc`;

  if (sort === 'najjeftinije') return sql`order by ${tail}`;
  if (sort === 'najskuplje') return sql`order by g.min_price desc, g.group_key asc`;
  if (sort === 'abecedno') {
    // Collated so that Č and Ć sort where a BCS reader expects, not after Z.
    return sql`order by unaccent(lower(b.title)) asc, ${tail}`;
  }
  if (sort === 'snizenje') {
    // Only 3.7% of the catalogue is discounted, so everything else ties at zero and the
    // tail decides — which is why the tail is cheapest-first rather than arbitrary.
    return sql`order by g.best_discount desc, ${tail}`;
  }
  if (sort === 'najnovije') return sql`order by g.first_seen desc, ${tail}`;

  // No explicit choice: be relevant when there is something to be relevant to.
  if (!trimmed) return sql`order by g.first_seen desc, ${tail}`;
  return sql`order by
      round(similarity(${scoredTitle}, regexp_replace(unaccent(lower(${trimmed})), '[^a-z0-9 ]', '', 'g'))::numeric, 1) desc,
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

/** `size_eu in (45, 46)`, or nothing when no sizes are selected. */
function sizeFilter(sizesEu: number[] | undefined) {
  if (!sizesEu || sizesEu.length === 0) return sql``;
  const list = sql.join(
    sizesEu.map((s) => sql`${s}`),
    sql`, `,
  );
  return sql`and exists (
    select 1 from offer_size f
    where f.offer_id = o.id and f.in_stock and f.size_eu in (${list})
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
        o.id, o.shop_id, o.product_id, o.title, o.raw_brand, o.url, o.image_url,
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
        ${titleFilter(query)}
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
    )
    select
      b.id            as "offerId",
      b.product_id    as "productId",
      pr.slug         as "productSlug",
      s.slug          as "shopSlug",
      s.name          as "shopName",
      b.title         as "title",
      b.raw_brand     as "brand",
      b.url           as "url",
      b.image_url     as "imageUrl",
      g.min_price     as "priceMinor",
      g.max_price     as "maxPriceMinor",
      b.original_price_minor as "originalPriceMinor",
      b.currency::text as "currency",
      g.shop_count    as "shopCount",
      -- Sizes are the union across the group: a shoe is available in 44 if any shop
      -- in the group has 44, which is the whole point of comparing shops.
      -- json_agg, not array_agg: the HTTP driver hands back Postgres arrays as the
      -- raw string "{40.00,41.00}", whereas JSON arrives as a real array.
      coalesce(
        (
          select json_agg(distinct f.size_eu order by f.size_eu)
          from offer_size f
          join candidate c on c.id = f.offer_id
          where c.group_key = g.group_key and f.in_stock
        ),
        '[]'::json
      ) as "sizesEu",
      -- The shops behind the count, cheapest first, so a card can show whose prices
      -- these are rather than only how many there are.
      coalesce(
        (
          select json_agg(x)
          from (
            select
              c.shop_slug as "slug",
              c.shop_name as "name",
              c.shop_logo as "logoUrl",
              min(c.price_minor) as p
            from candidate c
            where c.group_key = g.group_key
            group by 1, 2, 3
            order by p asc
          ) x
        ),
        '[]'::json
      ) as "shops",
      -- Total across every page, in the same round trip. A separate count query would
      -- double the latency and could disagree with the page under concurrent writes.
      count(*) over() as "totalCount"
    from grouped g
    join candidate b on b.id = g.best_offer_id
    join shop s on s.id = b.shop_id
    -- Only matched results have a product page to link to.
    left join product pr on pr.id = b.product_id
    ${resultOrder(query, sort)}
    limit ${limit} offset ${offset}
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
 */
export async function availableSizes(): Promise<number[]> {
  const rows = await db().execute(sql`
    select distinct sz.size_eu as "sizeEu"
    from offer_size sz
    join offer o on o.id = sz.offer_id
    join shop s on s.id = o.shop_id
    where sz.in_stock and s.active
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
    -- Counts groups, not offers, so a facet count matches the result count the header
    -- shows after the same click. Counting rows here would say "Nike 73" and then land
    -- on a page reporting 68.
    select
      o.raw_brand as "brand",
      count(distinct coalesce('p' || o.product_id::text, 'o' || o.id::text))::int as "count"
    from offer o
    join shop s on s.id = o.shop_id
    where o.in_stock and s.active and o.raw_brand is not null
      ${sizeFilter(sizesEu)}
      ${kidsFilter(wantsKids)}
      ${saleFilter(onSale)}
      ${shopFilter(shops)}
      ${genderFilter(genders)}
      ${modelFilter(modelKey)}
      ${titleFilter(query)}
    group by o.raw_brand
    order by 2 desc, o.raw_brand asc
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
}

export interface ProductDetail {
  id: number;
  slug: string;
  model: string;
  brand: string | null;
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
export async function productBySlug(slug: string): Promise<ProductDetail | null> {
  const rows = await db().execute(sql`
    select
      p.id              as "id",
      p.slug            as "slug",
      p.model           as "model",
      b.name            as "brand",
      p.style_code      as "styleCode",
      p.gender::text    as "gender",
      p.hero_image_url  as "heroImageUrl",
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
    };
  });

  return {
    id: Number(head.id),
    slug: String(head.slug),
    model: String(head.model),
    brand: head.brand === null ? null : String(head.brand),
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
