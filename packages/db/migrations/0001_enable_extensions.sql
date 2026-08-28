-- Extensions the matching and search pipeline depends on.
--
-- pg_trgm   trigram similarity, used by matching tier 3 (brand + model + colorway)
--           and by fuzzy search over product.search_doc.
-- unaccent  diacritic folding at the database level, so "muske" matches "muške"
--           even for text that did not go through the application's folder.
--
-- Both are available on Neon's free plan. `vector` is also available and gets
-- enabled when the Phase 2 embedding tier lands, not before.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent;
--> statement-breakpoint
-- Trigram index on the search document. Supports both ILIKE and similarity()
-- lookups; GIN is the right choice here because search_doc is long-ish text and
-- reads vastly outnumber writes (writes happen only during a crawl).
CREATE INDEX IF NOT EXISTS "product_search_doc_trgm_idx"
  ON "product" USING gin ("search_doc" gin_trgm_ops);
--> statement-breakpoint
-- Matching tier 3 compares brand + model + colorway. A trigram index on model
-- keeps candidate generation cheap as the catalogue grows.
CREATE INDEX IF NOT EXISTS "product_model_trgm_idx"
  ON "product" USING gin ("model" gin_trgm_ops);
