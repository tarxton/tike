CREATE TYPE "public"."crawl_status" AS ENUM('running', 'ok', 'failed', 'aborted_parse_threshold');--> statement-breakpoint
CREATE TYPE "public"."currency" AS ENUM('BAM', 'EUR');--> statement-breakpoint
CREATE TYPE "public"."deal_type" AS ENUM('none', 'cpc', 'revshare');--> statement-breakpoint
CREATE TYPE "public"."gender" AS ENUM('men', 'women', 'unisex', 'kids');--> statement-breakpoint
CREATE TYPE "public"."match_method" AS ENUM('gtin', 'style_code', 'fuzzy', 'manual');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('nbshop', 'magento2', 'woo', 'shopify', 'feed');--> statement-breakpoint
CREATE TABLE "brand" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"aliases" text[] DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "click" (
	"id" serial PRIMARY KEY NOT NULL,
	"offer_id" integer NOT NULL,
	"shop_id" integer NOT NULL,
	"clicked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"size_eu" numeric(4, 2),
	"referrer_path" text,
	"ua_hash" text
);
--> statement-breakpoint
CREATE TABLE "crawl_run" (
	"id" serial PRIMARY KEY NOT NULL,
	"shop_id" integer NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" "crawl_status" DEFAULT 'running' NOT NULL,
	"urls_seen" integer DEFAULT 0 NOT NULL,
	"urls_parsed" integer DEFAULT 0 NOT NULL,
	"parse_failures" integer DEFAULT 0 NOT NULL,
	"items_changed" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "offer" (
	"id" serial PRIMARY KEY NOT NULL,
	"shop_id" integer NOT NULL,
	"product_id" integer,
	"external_id" text NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"raw_brand" text,
	"sku" text,
	"image_url" text,
	"price_minor" integer NOT NULL,
	"original_price_minor" integer,
	"currency" "currency" DEFAULT 'BAM' NOT NULL,
	"in_stock" boolean DEFAULT false NOT NULL,
	"match_method" "match_method",
	"match_confidence" numeric(4, 3),
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offer_size" (
	"id" serial PRIMARY KEY NOT NULL,
	"offer_id" integer NOT NULL,
	"size_raw" text NOT NULL,
	"size_eu" numeric(4, 2) NOT NULL,
	"size_us" numeric(4, 1),
	"size_uk" numeric(4, 1),
	"in_stock" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_point" (
	"id" serial PRIMARY KEY NOT NULL,
	"offer_id" integer NOT NULL,
	"price_minor" integer NOT NULL,
	"currency" "currency" DEFAULT 'BAM' NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product" (
	"id" serial PRIMARY KEY NOT NULL,
	"brand_id" integer,
	"slug" text NOT NULL,
	"model" text NOT NULL,
	"colorway" text,
	"style_code" text,
	"gtin" text,
	"gender" "gender",
	"categories" text[] DEFAULT '{}' NOT NULL,
	"hero_image_url" text,
	"search_doc" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_alias" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"shop_id" integer NOT NULL,
	"external_id" text NOT NULL,
	"confidence" numeric(4, 3),
	"method" "match_method" NOT NULL,
	"is_match" boolean DEFAULT true NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_snapshot" (
	"id" serial PRIMARY KEY NOT NULL,
	"crawl_run_id" integer NOT NULL,
	"url" text NOT NULL,
	"hash" text NOT NULL,
	"storage_key" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_miss" (
	"id" serial PRIMARY KEY NOT NULL,
	"query" text NOT NULL,
	"size_eu" numeric(4, 2),
	"filters" jsonb,
	"searched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"base_url" text NOT NULL,
	"platform" "platform" NOT NULL,
	"sitemap_url" text,
	"currency" "currency" DEFAULT 'BAM' NOT NULL,
	"min_delay_ms" integer DEFAULT 1000 NOT NULL,
	"max_concurrency" integer DEFAULT 2 NOT NULL,
	"deal_type" "deal_type" DEFAULT 'none' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"crawl_config" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "click" ADD CONSTRAINT "click_offer_id_offer_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "click" ADD CONSTRAINT "click_shop_id_shop_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shop"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_run" ADD CONSTRAINT "crawl_run_shop_id_shop_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shop"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer" ADD CONSTRAINT "offer_shop_id_shop_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shop"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer" ADD CONSTRAINT "offer_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_size" ADD CONSTRAINT "offer_size_offer_id_offer_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_point" ADD CONSTRAINT "price_point_offer_id_offer_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_alias" ADD CONSTRAINT "product_alias_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_alias" ADD CONSTRAINT "product_alias_shop_id_shop_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shop"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_snapshot" ADD CONSTRAINT "raw_snapshot_crawl_run_id_crawl_run_id_fk" FOREIGN KEY ("crawl_run_id") REFERENCES "public"."crawl_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "brand_slug_key" ON "brand" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "click_shop_time_idx" ON "click" USING btree ("shop_id","clicked_at");--> statement-breakpoint
CREATE INDEX "click_offer_idx" ON "click" USING btree ("offer_id");--> statement-breakpoint
CREATE INDEX "crawl_run_shop_started_idx" ON "crawl_run" USING btree ("shop_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "offer_shop_external_key" ON "offer" USING btree ("shop_id","external_id");--> statement-breakpoint
CREATE INDEX "offer_product_idx" ON "offer" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "offer_shop_idx" ON "offer" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX "offer_in_stock_idx" ON "offer" USING btree ("in_stock");--> statement-breakpoint
CREATE UNIQUE INDEX "offer_size_offer_size_key" ON "offer_size" USING btree ("offer_id","size_eu");--> statement-breakpoint
CREATE INDEX "offer_size_size_stock_idx" ON "offer_size" USING btree ("size_eu","in_stock");--> statement-breakpoint
CREATE INDEX "price_point_offer_recorded_idx" ON "price_point" USING btree ("offer_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "product_slug_key" ON "product" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "product_style_code_idx" ON "product" USING btree ("style_code");--> statement-breakpoint
CREATE INDEX "product_gtin_idx" ON "product" USING btree ("gtin");--> statement-breakpoint
CREATE INDEX "product_brand_idx" ON "product" USING btree ("brand_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_alias_shop_external_key" ON "product_alias" USING btree ("shop_id","external_id");--> statement-breakpoint
CREATE INDEX "raw_snapshot_url_idx" ON "raw_snapshot" USING btree ("url");--> statement-breakpoint
CREATE INDEX "search_miss_query_idx" ON "search_miss" USING btree ("query");--> statement-breakpoint
CREATE UNIQUE INDEX "shop_slug_key" ON "shop" USING btree ("slug");