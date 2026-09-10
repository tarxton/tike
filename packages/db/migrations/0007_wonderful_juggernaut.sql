CREATE TABLE "product_slug_alias" (
	"slug" text PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_slug_alias" ADD CONSTRAINT "product_slug_alias_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_slug_alias_product_idx" ON "product_slug_alias" USING btree ("product_id");