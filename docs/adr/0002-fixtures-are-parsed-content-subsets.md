# ADR 0002: Fixtures store parsed-content subsets, not whole pages

- **Status:** accepted
- **Date:** 2026-08-29

## Context

Adapter tests run against committed copies of real shop pages, so a markup change shows
up as a failing test rather than as bad data in production.

The first fixtures were whole pages, ~500 KB each. Shop pages carry third-party
credentials in inline scripts, and these did too: a Google Maps browser key, a
Flowplayer JWT, a Facebook Graph access token, and variables named `SFClientSecret` and
`SFUniqueKey`. All are published by the shop on its own site, but committing them to a
public repository republishes another party's credentials and trips secret scanners.

Redacting them by pattern was tried and failed twice. Each round of redaction revealed a
credential the previous pattern list did not cover, and every new shop would restart that
race. A redaction placeholder even matched the scanner's own rule and was reported as a
leak.

## Decision

Fixtures keep only what the adapter parses:

- schema.org JSON-LD (identity, price)
- the product size list (per-size availability)
- breadcrumb and title (gender detection)

Everything else — scripts, styles, iframes, inline event handlers — is stripped at
capture time by `packages/crawler/scripts/sanitize-fixture.mjs`. Pattern-based redaction
remains as a second line of defence over what survives, and CI fails on any
credential-shaped string under `fixtures/`.

## Consequences

- The class of problem disappears: no inline scripts means no embedded credentials,
  whatever the next shop happens to load.
- Fixtures shrank from 2.5 MB to 127 KB, so clones and test runs are faster.
- A parser that later needs markup outside the kept subset requires re-capture. That is
  a deliberate trade: the sanitizer defines what "parseable page" means, and widening it
  is an explicit decision rather than an accident.
- Fixtures are no longer byte-exact captures, so they cannot be used to reason about
  page weight, asset loading, or anything outside the parsed subset.

## Alternatives considered

**Keep whole pages and redact by pattern.** Tried, and it failed twice in one session.
Correctness depended on a pattern list being exhaustive against every third-party script
any shop might load, which is not a property that can be maintained.

**Do not commit fixtures; fetch pages in tests.** Would make the suite depend on live
shops, hitting someone else's servers on every CI run and failing whenever they change or
rate-limit. Rejected outright.
