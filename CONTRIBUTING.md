# Contributing

## Commits

Conventional Commits, enforced by commitlint.

```
type(scope): subject
```

Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `ci`.
Scopes: `web`, `jobs`, `core`, `crawler`, `db`, `contracts`, `ci`, `docs`, `deps`, `repo`.

**Keep messages short.** Subject under 72 characters, and a body only when the _why_
is not obvious — one or two lines. Durable reasoning belongs in an ADR under
`docs/adr/`, not in the commit body.

```
feat(crawler): add NBSHOP adapter
fix(db): use unpooled connection for migrations
```

## Pull requests

Fill in the template: what, why, and the commands you actually ran. Short is fine.

## Before pushing

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm format:check
```

## Crawler changes

- `robots.txt` is law: honour `Disallow` and `Crawl-delay`, identify the crawler, keep
  per-domain concurrency at 2 or below, and never work around a 403.
- Fixtures are parsed-content subsets, never raw pages — see
  [ADR 0002](docs/adr/0002-fixtures-are-parsed-content-subsets.md). Capture them with
  `scripts/capture-fixtures.mjs`, which sanitizes automatically.
- Tests run against committed fixtures, never live sites.

## Database changes

Migrations are forward-only and expand-then-contract, so a rollback never needs a
down-migration. Never edit an applied migration. Reads use the HTTP driver, transactional
writes use the TCP driver — see [ADR 0001](docs/adr/0001-neon-driver-split.md).
