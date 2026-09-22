ALTER TABLE "brand" ADD COLUMN "logo_key" text;--> statement-breakpoint
ALTER TABLE "brand" ADD COLUMN "logo_source_url" text;--> statement-breakpoint
ALTER TABLE "brand" ADD COLUMN "logo_rejected" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "offer" ADD COLUMN "brand_logo_url" text;