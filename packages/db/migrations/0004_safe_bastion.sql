ALTER TABLE "offer_size" ADD COLUMN "gtin" text;--> statement-breakpoint
CREATE INDEX "offer_size_gtin_idx" ON "offer_size" USING btree ("gtin");