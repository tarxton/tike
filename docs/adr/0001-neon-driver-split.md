# ADR 0001: HTTP driver for reads, TCP driver for transactional writes

- **Status:** accepted
- **Date:** 2026-08-28

## Context

Neon offers two client drivers from `@neondatabase/serverless`:

- `neon()` — an HTTP driver. Each query is a single HTTPS request. No connection pool
  to manage, works on Cloudflare Workers, and suits a read path that is mostly
  independent single-statement queries.
- `Pool` / `Client` — a WebSocket driver speaking the Postgres wire protocol, with real
  sessions.

While verifying the first migration, a smoke test wrapped its inserts in
`begin` / … / `rollback` using the HTTP driver and then asserted the data was gone.
It was not: the row survived, and had to be deleted explicitly.

The cause is structural, not a bug. Each `sql\`…\``call over the HTTP driver is its own
request on its own connection, so`BEGIN`and`ROLLBACK` land in unrelated sessions and
do nothing. Multi-statement transactions are silently no-ops rather than errors, which is
the dangerous part: code appears to be transactional and is not.

This matters because the ingest pipeline is inherently multi-statement. Upserting an
offer and replacing its size rows must be atomic — a crash between the two would leave an
offer with no sizes, which the pipeline is required to treat as a parse failure rather
than an out-of-stock product.

## Decision

Split by workload, not by convenience:

- **Read path** (`apps/web` pages, API route handlers, `/go` redirect) uses the **HTTP
  driver** with the pooled `DATABASE_URL`. Single-statement queries, edge-compatible, no
  pool to leak.
- **Write path** (`apps/jobs` ingest, matching, backfills) uses the **TCP/WebSocket
  driver** with `DATABASE_URL_UNPOOLED`, inside real transactions.
- **Migrations** use `DATABASE_URL_UNPOOLED`, since DDL over PgBouncer is unreliable.

Any code that needs a transaction must import the write client. The read client will not
expose a `transaction()` helper, so reaching for one is a compile error rather than a
silent no-op.

## Consequences

- Two client entry points to maintain in `packages/db`, and a rule to remember about
  which one a given module may import. A lint rule can enforce this later if it slips.
- The read path stays deployable to Cloudflare Workers, which the hosting plan depends on.
- Jobs hold real connections, so they must run somewhere that tolerates that — GitHub
  Actions today, a VPS worker later. Both do.
- Tests that assert rollback behaviour must use the write client, or they will pass
  vacuously.

## Alternatives considered

**Use the TCP driver everywhere.** Simpler mental model, but it gives up Workers
compatibility on the read path and adds pool management to request handling for queries
that never needed a transaction.

**Use the HTTP driver everywhere and avoid transactions.** Would mean the ingest pipeline
could leave an offer without its sizes after a crash — exactly the state the parse-failure
rule exists to prevent. Rejected on correctness.
