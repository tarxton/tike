CREATE TABLE "image_cache" (
	"source_url" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"width" integer,
	"height" integer,
	"bytes" integer,
	"error" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "image_cache_key_idx" ON "image_cache" USING btree ("key");