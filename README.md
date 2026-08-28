# tike

A **size-first** shoe search engine for Bosnia and Herzegovina.

Most shoe searches start with a model and end in disappointment: the shoe exists, but not in
your size. tike inverts that. Pick your size first, and only see what a BiH shop can actually
sell you today — with prices compared across shops.

> Status: early development. Schema and the first platform adapter (NBSHOP, covering
> multiple BiH retailers) are in place; ingestion and search are next.

## How it works

```
        Cloudflare (CDN, cache)
                 │
         apps/web (Next.js)
         ├── pages, cached at the edge (ISR)
         ├── route handlers (API)
         └── /go/:offerId → tracked redirect to the shop
                 │
        ┌────────┴─────────┐
   PostgreSQL          Cloudflare R2
   products,           product images
   offers, sizes
        ▲
        │
  scheduled crawls (GitHub Actions)
  sitemap → product page → parse → normalize → match → index
```

Shops are ingested by **platform adapter**, not by bespoke scraper: one NBSHOP adapter covers
several BiH retailers, one Magento 2 adapter covers several more. Adding a shop on a known
platform is a config row, not code.

The interesting problems are in `packages/core`:

- **Size normalization** — EU/US/UK conversion is brand- and gender-dependent, and shops write
  sizes as `44`, `44,5`, `44 2/3`, or `EU 44`. Sizes are normalized once, at ingest.
- **Product matching** — the same shoe across shops, matched by GTIN, then manufacturer style
  code, then fuzzy similarity, with anything uncertain queued for human review rather than
  guessed at.
- **Search for a single-variant BCS locale** — folding `č ć ž š đ` so `muske patike` finds
  `muške patike`, and silently expanding regional synonyms.

## Repository layout

| Path                 | Contents                                                    |
| -------------------- | ----------------------------------------------------------- |
| `apps/web`           | Next.js site, API route handlers, admin, outclick redirect  |
| `apps/jobs`          | crawl / match / index processors, run on a schedule         |
| `packages/core`      | framework-free domain logic: sizes, money, text, matching   |
| `packages/crawler`   | platform adapters (NBSHOP, Magento 2, WooCommerce, Shopify) |
| `packages/db`        | Drizzle schema and migrations                               |
| `packages/contracts` | Zod schemas shared across every boundary                    |
| `docs/adr`           | architecture decision records                               |

## Local setup

Requires Node ≥ 20.19 and pnpm.

```bash
pnpm install
cp .env.example .env   # fill in DATABASE_URL from a Neon branch
pnpm test
pnpm dev
```

| Command                                | Does                         |
| -------------------------------------- | ---------------------------- |
| `pnpm dev`                             | run the site locally         |
| `pnpm test`                            | unit tests (Vitest)          |
| `pnpm typecheck`                       | TypeScript, no emit          |
| `pnpm db:generate` / `pnpm db:migrate` | Drizzle migrations           |
| `pnpm db:studio`                       | browse the database          |
| `pnpm crawl <shop>`                    | run one shop's crawl locally |

## Crawling policy

tike reads publicly available product pages from BiH retailers, and does so politely:

- `robots.txt` and any `Crawl-delay` are honoured, per shop, on every run.
- The crawler identifies itself with a contact URL, keeps at most two concurrent requests per
  domain, and backs off on errors.
- Bot protection is never bypassed. A shop that blocks the crawler is removed, not worked around.
- Any shop can ask to be delisted and will be, promptly.

Shops are welcome to supply a product feed instead — it is more accurate for them and cheaper
for everyone. See the contact page.

## Design decisions

Non-obvious choices are recorded in [`docs/adr/`](docs/adr), including the split between
read and write database drivers, and why fixtures store parsed-content subsets rather
than whole pages.

See [CONTRIBUTING.md](CONTRIBUTING.md) for commit conventions and the rules that apply to
crawler and database changes.

## Design decisions

Non-obvious choices are recorded in [`docs/adr/`](docs/adr), including the split between
read and write database drivers, and why fixtures store parsed-content subsets rather
than whole pages.

See [CONTRIBUTING.md](CONTRIBUTING.md) for commit conventions and the rules that apply to
crawler and database changes.

## Licence

Not yet chosen.
