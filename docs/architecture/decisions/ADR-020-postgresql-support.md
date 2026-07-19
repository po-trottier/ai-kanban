# ADR-020: PostgreSQL support for production

Status: **Accepted — implemented** (2026-07)

## Context

Production runs on **SQLite** today: one write connection per process, a read-only WAL companion,
Litestream/VACUUM backups, and a single app replica that is the only writer
([ADR-003](ADR-003-drizzle-sqlite.md), [deployment.md](../deployment.md)). We want
**PostgreSQL as the production database** (multi-writer, horizontally scalable, the default the
`docker-compose.yml` launches), while **development keeps SQLite** for its zero-setup, single-file
ergonomics.

The catch is that our data layer is not merely "SQLite-flavoured SQL" — it is **built on
better-sqlite3 being synchronous**, and that assumption is load-bearing:

- **The unit of work** (`packages/db/src/unit-of-work.ts`) does manual `BEGIN IMMEDIATE` / `COMMIT`
  on the shared connection and serializes callers through an in-process queue. Its documented
  invariant: _"safe only because every repository method is synchronous under the hood — an await
  chain inside `fn` drains entirely in microtasks without yielding to I/O."_ Postgres is **async
  network I/O**, so every `await` inside a unit of work would yield to the event loop and let another
  caller's statements interleave into the open transaction. The whole concurrency model must change.
- **The schema** (`packages/db/src/schema.ts`) is `sqliteTable`. Drizzle has **no shared table
  builder** across dialects — Postgres needs a parallel `pgTable` definition.
- **Every repository** (~20) is typed `BetterSQLite3Database` and calls the synchronous
  `.all()/.get()/.run()`. Postgres uses the async driver.

## Decision

Support PostgreSQL for production behind the existing **ports** (`core` `UnitOfWork` /
`*Repository` interfaces), selected at boot by a `DATABASE_URL` (Postgres) vs `DATABASE_PATH`
(SQLite) environment split. `core` and the services never learn which engine is underneath — the
hexagonal boundary already isolates them. Dev and the test suite keep SQLite; production
`docker-compose up` launches a Postgres service and points the app at it.

## Implementation

1. **Parallel `pgTable` schema** — `packages/db/src/schema.pg.ts` mirrors `schema.ts`
   column-for-column (ISO-string TEXT timestamps, `jsonb` for JSON, native `boolean`, and
   `position text COLLATE "C"` so the base-62 fractional keys order byte-wise on any Postgres). A
   drizzle-kit Postgres migration set lives at `migrations/pg/` (one `0000_init`, v0 rule).
2. **Async pg repositories** — `packages/db/src/pg/repositories/*` implement the same core ports over
   the async Drizzle pg builder; pg SQLSTATE error mapping (`pg/errors.ts`) reproduces the
   DuplicatePositionError / conflict contract.
3. **Async unit of work** — `PostgresUnitOfWork` runs a real `db.transaction()` per unit of work; no
   in-process serialization queue (Postgres gives genuine isolation + multi-writer concurrency). The
   SQLite `SqliteUnitOfWork` stays for dev.
4. **Engine factory** — `createDataLayer` (in `packages/db`) picks Postgres when `DATABASE_URL` is
   set, else SQLite; the composition root (`wire.ts`) consumes a uniform `DataLayer`. The
   SQLite-only operational surface (VACUUM snapshots, the db-size metric) is simply absent on
   Postgres.
5. **docker-compose** — a `postgres:17` service with a named volume + healthcheck; the `app` service
   depends on it and sets `DATABASE_URL`.
6. **Verification** — two integration tests exercise Postgres via **PGlite** (an in-process WASM
   Postgres — real pg, no server, runs in the normal CI): `db/src/pg/services.integration.test.ts`
   (the core services over the pg unit of work — lifecycle, waiting-lane, the UNIQUE(lane,position)
   backstop, optimistic locking, comments, board snapshot) and `server/src/postgres-app.integration.test.ts`
   (the whole HTTP app booted on Postgres). A dedicated CI job against a real `postgres` service is
   a straightforward follow-up hardening step.

## Consequences

- Production gains multi-writer concurrency and standard operational tooling; the single-writer
  constraint and Litestream sidecar become the _optional_ small-deployment path, not the only one.
- The port abstraction that already exists (`core` never imports `drizzle`/`better-sqlite3`) is what
  makes this a **data-layer-only** change: no `core`, `server`, or `web` code moves.
- Cost is real: ~20 repositories rewritten to async, a second schema + migration set, a new unit of
  work, and a doubled integration-test matrix. It is sequenced as its own effort rather than bundled
  with feature work.
