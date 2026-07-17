import { type ProblemDetails } from '@rivian-kanban/core'

/**
 * RFC 9457 problem+json handling. The document schema is core's
 * `problemDetailsSchema` (single-schema rule) — the same declaration the
 * server's problem mapper is typed against, so the parsed shape (string
 * issue paths included) can never drift from the wire shape.
 */
export { problemDetailsSchema, type ProblemDetails } from '@rivian-kanban/core'

/** A non-2xx REST response, carrying the parsed problem document. */
export class ApiError extends Error {
  readonly status: number
  readonly problem: ProblemDetails

  constructor(status: number, problem: ProblemDetails) {
    super(problem.title ?? `Request failed with status ${String(status)}`)
    this.name = 'ApiError'
    this.status = status
    this.problem = problem
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}

/** True for optimistic-lock / stale-neighbor conflicts (ADR-012 UX). */
export function isConflictError(error: unknown): boolean {
  return isApiError(error) && error.status === 409
}

export function isUnauthorizedError(error: unknown): boolean {
  return isApiError(error) && error.status === 401
}
