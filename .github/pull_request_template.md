## What

<!-- One or two sentences. What changed? -->

## Why

<!-- The problem this solves. Link an issue or ADR if there is one. -->

## Verification

<!-- Commands actually run, and their result. Not "should work". -->

- [ ] `pnpm test` passes
- [ ] `pnpm typecheck` passes
- [ ] Manually checked in the browser (if user-facing)

## Checklist

- [ ] No secrets, credentials, or `.env` contents in the diff
- [ ] Crawler changes respect robots.txt, crawl delay, and the identified User-Agent
- [ ] Schema changes are forward-only (expand-then-contract)
- [ ] Adapter changes come with fixtures and a fixture-driven test
