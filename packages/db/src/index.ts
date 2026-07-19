/**
 * @rivian-kanban/db — Drizzle schema, migrations, and repository adapters
 * implementing the ports owned by @rivian-kanban/core.
 *
 * The only package allowed to import better-sqlite3/drizzle-orm (ADR-003,
 * enforced by dependency-cruiser). The composition root consumes exactly:
 * `openDatabase` → `SqliteUnitOfWork` → core services, plus the seeds.
 */

export * from './connection.ts'
export * from './data-layer.ts'
export * from './pg/connection.ts'
export * from './unit-of-work.ts'
export * from './seed.ts'
