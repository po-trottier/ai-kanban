# ADR-003: Drizzle ORM on SQLite (WAL) now; structurally-enforced Postgres portability

**Status**: accepted (2026-07-16)

> **Update (v1.0.0):** PostgreSQL is now implemented and shipped as a first-class backend
> behind the repository ports, selected via `DATABASE_URL` (see ADR-020). The "one-time
> mechanical schema rewrite" below has happened; Postgres is a production option, not a future
> migration.

## Context

Requirement: SQLite today, production-portable to Postgres, no hard SQLite dependency.
Candidates: Drizzle, Kysely, Knex, Prisma.

## Decision

- **Drizzle ORM 0.45.x** (pin exact; 1.0 is at RC with breaking relational-query changes —
  upgrade deliberately via the official guide) on **better-sqlite3** with
  `journal_mode=WAL`.
- Honest portability posture: Drizzle schemas are dialect-specific (`sqlite-core` vs
  `pg-core`), so the Postgres move is a **one-time mechanical schema rewrite + regenerated
  migrations** — not a config flip. Kysely/Knex would be nearer config-flip but lose Drizzle's
  type-safety and migration ergonomics; the repository ports neutralize the difference.
- Portability is **enforced, not hoped for**: dependency-cruiser forbids `better-sqlite3` and
  `drizzle-orm` imports outside `packages/db`; conservative column types only (TEXT / INTEGER /
  REAL, ISO-8601 TEXT timestamps, TEXT UUIDv7 ids); no SQLite-only SQL features; repositories
  implement core-owned ports.
- SQLite at this scale is fine: single node, kanban-scale write rates, read-dominant traffic
  (sqlite.org's own when-to-use guidance); WAL + `busy_timeout` handle concurrent readers.
  Known limits accepted and monitored: single writer, sync calls briefly block the event loop,
  WAL checkpoint starvation watched via a metrics gauge.

## Consequences

The single-process constraint applies only to SQLite deployments; on Postgres (via
`DATABASE_URL`) the app scales to multiple Node processes / nodes (see deployment.md). A
dedicated Postgres CI job against a real `postgres` service remains as future hardening —
today the SQL is proven in normal CI by PGlite integration tests.
