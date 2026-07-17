/**
 * Hand-written in-memory fakes implementing the core ports, plus the wired
 * test scenario. Consumed by core unit tests and reusable from db/server test
 * suites via `@rivian-kanban/core/testing` (docs/dev/testing.md — never
 * mocking-library constructs).
 */

export * from './defaults.ts'
export * from './fakes.ts'
export * from './in-memory-db.ts'
export * from './scenario.ts'
