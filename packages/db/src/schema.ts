import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/*
 * Conventions
 * -----------
 * money      integer minor units (fening/cents) + a currency column. Never float.
 * size_eu    numeric(4,2) — exact decimal, so 44, 44.50 and 44.67 (44 2/3) all compare
 *            exactly. Normalized once at ingest; nothing converts at query time.
 * time       timestamptz everywhere.
 * deletion   offers are never deleted, only marked out of stock (price history and
 *            inbound links must survive).
 */

export const platformEnum = pgEnum('platform', [
  'nbshop',
  'magento2',
  'woo',
  'shopify',
  'officeshoes',
  'feed',
]);

export const genderEnum = pgEnum('gender', ['men', 'women', 'unisex', 'kids']);

export const currencyEnum = pgEnum('currency', ['BAM', 'EUR']);

/** How a shop is monetized. `none` until a deal is actually signed. */
export const dealTypeEnum = pgEnum('deal_type', ['none', 'cpc', 'revshare']);

export const crawlStatusEnum = pgEnum('crawl_status', [
  'running',
  'ok',
  'failed',
  'aborted_parse_threshold',
]);

/** Which strategy matched an offer to a canonical product. */
export const matchMethodEnum = pgEnum('match_method', ['gtin', 'style_code', 'fuzzy', 'manual']);

// ---------------------------------------------------------------------------
// Shops and crawling
// ---------------------------------------------------------------------------

export const shop = pgTable(
  'shop',
  {
    id: serial('id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    baseUrl: text('base_url').notNull(),
    platform: platformEnum('platform').notNull(),
    sitemapUrl: text('sitemap_url'),
    currency: currencyEnum('currency').notNull().default('BAM'),
    /** Per-shop politeness, overriding the global defaults. Never below robots.txt. */
    minDelayMs: integer('min_delay_ms').notNull().default(1000),
    maxConcurrency: integer('max_concurrency').notNull().default(2),
    dealType: dealTypeEnum('deal_type').notNull().default('none'),
    /** False disables crawling entirely — used to honour an opt-out immediately. */
    active: boolean('active').notNull().default(true),
    /** Free-form adapter settings (selectors, sitemap quirks) validated by Zod at use. */
    crawlConfig: jsonb('crawl_config'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('shop_slug_key').on(t.slug)],
);

export const crawlRun = pgTable(
  'crawl_run',
  {
    id: serial('id').primaryKey(),
    shopId: integer('shop_id')
      .notNull()
      .references(() => shop.id, { onDelete: 'cascade' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    status: crawlStatusEnum('status').notNull().default('running'),
    urlsSeen: integer('urls_seen').notNull().default(0),
    urlsParsed: integer('urls_parsed').notNull().default(0),
    /** Feeds the 5% circuit breaker: too many failures aborts the run without writing. */
    parseFailures: integer('parse_failures').notNull().default(0),
    itemsChanged: integer('items_changed').notNull().default(0),
    error: text('error'),
  },
  (t) => [index('crawl_run_shop_started_idx').on(t.shopId, t.startedAt)],
);

/** Raw fetched HTML, kept for debugging and re-parsing without re-crawling. */
export const rawSnapshot = pgTable(
  'raw_snapshot',
  {
    id: serial('id').primaryKey(),
    crawlRunId: integer('crawl_run_id')
      .notNull()
      .references(() => crawlRun.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    /** Content hash; unchanged pages are skipped rather than re-parsed. */
    hash: text('hash').notNull(),
    /** Object storage key. The body itself never lives in Postgres. */
    storageKey: text('storage_key'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('raw_snapshot_url_idx').on(t.url)],
);

// ---------------------------------------------------------------------------
// Canonical catalogue
// ---------------------------------------------------------------------------

export const brand = pgTable(
  'brand',
  {
    id: serial('id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    /** Spellings seen in the wild ("adidas Originals", "ADIDAS") mapped to this brand. */
    aliases: text('aliases').array().notNull().default([]),
  },
  (t) => [uniqueIndex('brand_slug_key').on(t.slug)],
);

/** One canonical shoe: a model in a colourway. Offers from many shops point here. */
export const product = pgTable(
  'product',
  {
    id: serial('id').primaryKey(),
    brandId: integer('brand_id').references(() => brand.id, { onDelete: 'restrict' }),
    slug: text('slug').notNull(),
    model: text('model').notNull(),
    colorway: text('colorway'),
    /** Manufacturer style code (DV0787-100) when known — the strongest match key. */
    styleCode: text('style_code'),
    gtin: text('gtin'),
    gender: genderEnum('gender'),
    categories: text('categories').array().notNull().default([]),
    heroImageUrl: text('hero_image_url'),
    /** Diacritic-folded, lowercased text for trigram search. */
    searchDoc: text('search_doc').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('product_slug_key').on(t.slug),
    index('product_style_code_idx').on(t.styleCode),
    index('product_gtin_idx').on(t.gtin),
    index('product_brand_idx').on(t.brandId),
  ],
);

// ---------------------------------------------------------------------------
// Offers — one shop's listing of a product
// ---------------------------------------------------------------------------

export const offer = pgTable(
  'offer',
  {
    id: serial('id').primaryKey(),
    shopId: integer('shop_id')
      .notNull()
      .references(() => shop.id, { onDelete: 'cascade' }),
    /** Null while the offer sits unmatched in the review queue. */
    productId: integer('product_id').references(() => product.id, { onDelete: 'set null' }),
    /** The shop's own product id, unique within that shop. */
    externalId: text('external_id').notNull(),
    url: text('url').notNull(),
    title: text('title').notNull(),
    rawBrand: text('raw_brand'),
    sku: text('sku'),
    imageUrl: text('image_url'),
    /** Guards matching: a kids shoe must never merge into its adult namesake. */
    gender: genderEnum('gender'),
    priceMinor: integer('price_minor').notNull(),
    originalPriceMinor: integer('original_price_minor'),
    currency: currencyEnum('currency').notNull().default('BAM'),
    /** True when any size is in stock. Denormalized from offer_size for cheap filtering. */
    inStock: boolean('in_stock').notNull().default(false),
    matchMethod: matchMethodEnum('match_method'),
    matchConfidence: numeric('match_confidence', { precision: 4, scale: 3, mode: 'number' }),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    /** Drives the staleness rule: unseen for 3 runs means out of stock, never deleted. */
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('offer_shop_external_key').on(t.shopId, t.externalId),
    index('offer_product_idx').on(t.productId),
    index('offer_shop_idx').on(t.shopId),
    index('offer_in_stock_idx').on(t.inStock),
  ],
);

/** The heart of the product: per-size availability. */
export const offerSize = pgTable(
  'offer_size',
  {
    id: serial('id').primaryKey(),
    offerId: integer('offer_id')
      .notNull()
      .references(() => offer.id, { onDelete: 'cascade' }),
    /** The shop's original string ("44 2/3", "EU 44"), kept for debugging. */
    sizeRaw: text('size_raw').notNull(),
    sizeEu: numeric('size_eu', { precision: 4, scale: 2, mode: 'number' }).notNull(),
    sizeUs: numeric('size_us', { precision: 4, scale: 1, mode: 'number' }),
    sizeUk: numeric('size_uk', { precision: 4, scale: 1, mode: 'number' }),
    inStock: boolean('in_stock').notNull().default(false),
    /**
     * The barcode for this exact shoe in this exact size, when the shop publishes one.
     *
     * A GTIN-13 is issued per product *and* size, so two shops quoting the same code are
     * selling the identical thing — stronger evidence than any style code or title, and
     * what matching tier 1 runs on. NBSHOP exposes it per size; Office Shoes gives one
     * per product, which is why this lives on the size rather than the offer.
     */
    gtin: text('gtin'),
  },
  (t) => [
    uniqueIndex('offer_size_offer_size_key').on(t.offerId, t.sizeEu),
    // The core query: "who has EU 44 in stock right now?"
    index('offer_size_size_stock_idx').on(t.sizeEu, t.inStock),
    // Matching looks shoes up by barcode across shops.
    index('offer_size_gtin_idx').on(t.gtin),
  ],
);

export const pricePoint = pgTable(
  'price_point',
  {
    id: serial('id').primaryKey(),
    offerId: integer('offer_id')
      .notNull()
      .references(() => offer.id, { onDelete: 'cascade' }),
    priceMinor: integer('price_minor').notNull(),
    currency: currencyEnum('currency').notNull().default('BAM'),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('price_point_offer_recorded_idx').on(t.offerId, t.recordedAt)],
);

/**
 * Persisted matching decisions, so a reviewed item is never queued twice — including
 * deliberate "these are not the same shoe" rejections.
 */
export const productAlias = pgTable(
  'product_alias',
  {
    id: serial('id').primaryKey(),
    productId: integer('product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'cascade' }),
    shopId: integer('shop_id')
      .notNull()
      .references(() => shop.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    confidence: numeric('confidence', { precision: 4, scale: 3, mode: 'number' }),
    method: matchMethodEnum('method').notNull(),
    /** False records a reviewed rejection, which is as valuable as a confirmation. */
    isMatch: boolean('is_match').notNull().default(true),
    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('product_alias_shop_external_key').on(t.shopId, t.externalId)],
);

// ---------------------------------------------------------------------------
// Outclicks — the monetization evidence
// ---------------------------------------------------------------------------

export const click = pgTable(
  'click',
  {
    id: serial('id').primaryKey(),
    offerId: integer('offer_id')
      .notNull()
      .references(() => offer.id, { onDelete: 'cascade' }),
    shopId: integer('shop_id')
      .notNull()
      .references(() => shop.id, { onDelete: 'cascade' }),
    clickedAt: timestamp('clicked_at', { withTimezone: true }).notNull().defaultNow(),
    /** Size the user had filtered on, when there was one — tells shops what sells. */
    sizeEu: numeric('size_eu', { precision: 4, scale: 2, mode: 'number' }),
    referrerPath: text('referrer_path'),
    /** Hashed, never the raw user agent or IP — no personal data is stored. */
    uaHash: text('ua_hash'),
  },
  (t) => [
    index('click_shop_time_idx').on(t.shopId, t.clickedAt),
    index('click_offer_idx').on(t.offerId),
  ],
);

/** Logged zero-result searches — the best signal for missing catalogue or bad synonyms. */
export const searchMiss = pgTable(
  'search_miss',
  {
    id: serial('id').primaryKey(),
    query: text('query').notNull(),
    sizeEu: numeric('size_eu', { precision: 4, scale: 2, mode: 'number' }),
    filters: jsonb('filters'),
    searchedAt: timestamp('searched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('search_miss_query_idx').on(t.query)],
);
