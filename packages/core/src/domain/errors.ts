import { type Card } from './entities.ts'
import { type LaneKey } from './constants.ts'

/**
 * Typed domain errors. Validation errors are Zod's own ZodError. The server
 * maps these to problem+json statuses: PolicyDeniedError → 403,
 * IllegalTransitionError → 422, ConflictError/ArchivedError/
 * LimitExceededError → 409, NotFoundError → 404.
 */

/** A configurable-policy or always-on identity rule denied the action (403). */
export class PolicyDeniedError extends Error {
  readonly rule: string

  constructor(rule: string) {
    super(`policy denied: ${rule}`)
    this.name = 'PolicyDeniedError'
    this.rule = rule
  }
}

/** The workflow graph has no such edge while transition enforcement is on (422). */
export class IllegalTransitionError extends Error {
  readonly from: LaneKey
  readonly to: LaneKey

  constructor(from: LaneKey, to: LaneKey) {
    super(`illegal transition: ${from} -> ${to}`)
    this.name = 'IllegalTransitionError'
    this.from = from
    this.to = to
  }
}

/**
 * Optimistic-lock mismatch, stale move neighbors, or an exhausted uniqueness
 * retry (409). Carries the current card state when available so clients can
 * refetch-and-redo (ADR-012).
 */
export class ConflictError extends Error {
  readonly current: Card | undefined

  constructor(message: string, current?: Card) {
    super(message)
    this.name = 'ConflictError'
    this.current = current
  }
}

/** Archived cards are read-only except reopen (409, `card-archived`). */
export class ArchivedError extends Error {
  constructor() {
    super('card is archived and read-only except reopen')
    this.name = 'ArchivedError'
  }
}

export class NotFoundError extends Error {
  readonly resource: string

  constructor(resource: string) {
    super(`${resource} not found`)
    this.name = 'NotFoundError'
    this.resource = resource
  }
}

/** A hard cap was hit (attachment size/count) — 409/413 at the edge. */
export class LimitExceededError extends Error {
  readonly limit: number

  constructor(message: string, limit: number) {
    super(message)
    this.name = 'LimitExceededError'
    this.limit = limit
  }
}

/**
 * Port-contract error: the `UNIQUE(lane_id, position)` backstop fired.
 * Repository adapters translate the database violation into this; services
 * retry the transaction once with re-read neighbors (ADR-006).
 */
export class DuplicatePositionError extends Error {
  constructor() {
    super('duplicate position key in lane')
    this.name = 'DuplicatePositionError'
  }
}
