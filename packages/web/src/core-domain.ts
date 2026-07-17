/**
 * The SPA's view of `@rivian-kanban/core`: domain schemas/types only.
 *
 * `vite.config.ts` aliases the package name here so the browser bundle (and
 * the web test pipeline) never loads core's server-side services — the SPA
 * talks to them over REST, and executing them in the web pipeline skews their
 * coverage mapping against the native-Node backend test runs (ADR-014).
 *
 * Type checking still resolves the real package, so anything re-exported here
 * stays schema-identical (single-schema rule, docs/dev/standards.md).
 */

/** @public */
export * from '../../core/src/domain/constants.ts'
/** @public */
export * from '../../core/src/domain/dates.ts'
/** @public */
export * from '../../core/src/domain/entities.ts'
/** @public */
export * from '../../core/src/domain/events.ts'
/** @public */
export * from '../../core/src/domain/policy.ts'
/** @public */
export * from '../../core/src/domain/commands.ts'
/** @public */
export * from '../../core/src/domain/errors.ts'
/** @public */
export * from '../../core/src/domain/cursor.ts'
/** @public */
export * from '../../core/src/domain/sse.ts'
/** @public */
export * from '../../core/src/domain/problem.ts'
/** @public */
export * from '../../core/src/domain/envelopes.ts'
/**
 * The policy engine is pure domain logic over the document (it imports only
 * domain modules), and ADR-013 promises ONE evaluation path for every
 * surface — the SPA's affordances must run the same rules the server
 * re-validates with, never a re-implementation.
 * @public
 */
export * from '../../core/src/policy/policy-engine.ts'
