# tike

A **size-first** shoe search engine for Bosnia and Herzegovina.

Most shoe searches start with a model and end in disappointment: the shoe exists, but not in
your size. tike inverts that. Pick your size first, and only see what a BiH shop can actually
sell you today — with prices compared across shops.

**Live:** <https://tike-web.tarxton-2004.workers.dev>

> Status: five retailers ingested — Buzz Sneaker Station, Office Shoes, Sport Reality,
> Sport Vision and Đak Sport — currently around **10,000 in-stock listings** across **9,000
> products**, refreshed nightly. Search, size filtering, cross-shop price comparison and
> tracked click-out are live. Not yet on a real domain, and deliberately not indexable until
> it is.

## How it works

```
        Cloudflare Workers (OpenNext)
                 │
         apps/web (Next.js)
         ├── /patike        search, size + brand + shop filters
         ├── /patika/:slug  one shoe, every shop that sells it
         ├── /api/modeli    model typeahead
         └── /go/:offerId   tracked redirect to the shop
                 │
        ┌────────┴─────────┐
   Neon Postgres       Cloudflare R2
   products,           product images,
   offers, sizes,      one rendition per shop
   price history
        ▲
        │
  scheduled crawls (GitHub Actions, nightly)
  sitemap → product page → parse → normalize → match → images
```

Shops are ingested by **platform adapter**, not by bespoke scraper: one NBSHOP adapter covers
three BiH retailers, and a Magento 2 adapter covers Đak Sport. Adding a shop on a known
platform is a config row, not code.

The interesting problems are in `packages/core` and `apps/jobs`:

- **Size normalization** — EU/US/UK conversion is brand- and gender-dependent, and shops write
  sizes as `44`, `44,5`, `44 2/3`, `38-2/3` or `EU 44`. Sizes are normalized once, at ingest,
  never at query time.
- **Product matching** — the same shoe across shops, matched by GTIN, then manufacturer style
  code, then fuzzy similarity, with union-find clustering and guards that refuse a merge which
  would put two listings from one shop on one product. Anything uncertain is left unmatched
  rather than guessed at.
- **Naming** — retailers write the same model several ways (`Total 90` / `Total90`,
  `Uno Lite` / `Uno-Lite`, three different apostrophes in `Air Force 1 '07`) and bury the
  audience in the title. One model gets one name, chosen by the catalogue's own consensus.
- **Image renditions** — every shop photographs on a different backdrop at a different aspect
  ratio, and some publish an editorial photograph first. Images are copied once, the backdrop
  is flood-filled to white from the border, and the packshot is chosen over the scene shot by
  measuring the result.
- **Search for a single-variant BCS locale** — folding `č ć ž š đ` so `muske patike` finds
  `muške patike`, with trigram typo tolerance as a second pass when an exact search returns
  nothing.

## Repository layout

| Path                 | Contents                                                  |
| -------------------- | --------------------------------------------------------- |
| `apps/web`           | Next.js site, API route handlers, outclick redirect       |
| `apps/jobs`          | crawl / match / image processors, run on a schedule       |
| `packages/core`      | framework-free domain logic: sizes, money, text, matching |
| `packages/crawler`   | platform adapters (NBSHOP, Magento 2, Office Shoes)       |
| `packages/db`        | Drizzle schema, migrations and read queries               |
| `packages/contracts` | Zod schemas shared across every boundary                  |
| `docs/adr`           | architecture decision records                             |

## Local setup

Requires Node ≥ 20.19 and pnpm.

```bash
pnpm install
cp .env.example .env.local   # fill in DATABASE_URL from a Neon branch
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

`.env.local` lives at the repository root and is read by both the site and the jobs runner;
the Neon CLI writes it there too.

## Crawling policy

tike reads publicly available product pages from BiH retailers, and does so politely:

- `robots.txt` and any `Crawl-delay` are honoured, per shop, on every run.
- The crawler identifies itself with a contact URL and makes **one request at a time per
  domain**, spaced by the larger of the shop's `Crawl-delay` and tike's own floor, backing off
  exponentially on 429 and any 5xx.
- Bot protection is never bypassed. A shop that blocks an identified crawler is stopped and
  contacted, not worked around.
- One shop is crawled under written permission from its operator, at the rate they agreed.
- Any shop can ask to be delisted and will be, promptly.
- A run that fails to parse more than 5% of pages aborts and writes nothing, so a markup
  change is loud rather than silently marking a shop out of stock.

Shops are welcome to supply a product feed instead — it is more accurate for them and cheaper
for everyone.

## Design decisions

Non-obvious choices are recorded in [`docs/adr/`](docs/adr), including the split between
read and write database drivers, and why fixtures store parsed-content subsets rather
than whole pages.

See [CONTRIBUTING.md](CONTRIBUTING.md) for commit conventions and the rules that apply to
crawler and database changes.

## Licence

Not yet chosen.
