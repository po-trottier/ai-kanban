# ADR-020: PostgreSQL support for production

Status: **Accepted — implementation staged** (2026-07)

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

This is why it is **staged**, not a one-commit change.

## Decision

Support PostgreSQL for production behind the existing **ports** (`core` `UnitOfWork` /
`*Repository` interfaces), selected at boot by a `DATABASE_URL` (Postgres) vs `DATABASE_PATH`
(SQLite) environment split. `core` and the services never learn which engine is underneath — the
hexagonal boundary already isolates them. Dev and the test suite keep SQLite; production
`docker-compose up` launches a Postgres service and points the app at it.

## Implementation plan

1. **Dialect-neutral repository code.** Rewrite the repositories to `await` the Drizzle query builder
   (it is thenable on both dialects) instead of the better-sqlite3-only `.all()/.get()/.run()`, and
   take the Drizzle handle + the schema tables by injection rather than importing the SQLite schema
   directly. Keep column shapes identical (ISO-string timestamps in `text`, integers, `0/1` booleans)
   so one repository body serves both.
2. **Parallel `pgTable` schema** (`schema.pg.ts`) mirroring `schema.ts` column-for-column, plus a
   drizzle-kit Postgres migration set (`migrations/pg/`). v0 rule still holds: one `0000_init`.
3. **Async unit of work** for Postgres: real `BEGIN/COMMIT` on a pooled client with `SERIALIZABLE`
   (or `REPEATABLE READ` + retry) transactions — no in-process serialization queue, because Postgres
   gives real transactional isolation. The SQLite `SqliteUnitOfWork` stays for dev.
4. **Connection factory** picks the engine from env and returns the matching `DbConnection` +
   `UnitOfWork`; the composition root (`wire.ts`) is otherwise unchanged.
5. **docker-compose**: add a `postgres:17` service with a named volume and healthcheck; the `app`
   service depends on it and sets `DATABASE_URL`. SQLite + Litestream stays as the documented
   lightweight single-node alternative.
6. **Tests**: run the integration suite against **both** engines — SQLite temp files as today, and a
   Postgres service in CI (a `services: postgres` job) — so the ports are proven identical on both.

## Consequences

- Production gains multi-writer concurrency and standard operational tooling; the single-writer
  constraint and Litestream sidecar become the _optional_ small-deployment path, not the only one.
- The port abstraction that already exists (`core` never imports `drizzle`/`better-sqlite3`) is what
  makes this a **data-layer-only** change: no `core`, `server`, or `web` code moves.
- Cost is real: ~20 repositories rewritten to async, a second schema + migration set, a new unit of
  work, and a doubled integration-test matrix. It is sequenced as its own effort rather than bundled
  with feature work.
