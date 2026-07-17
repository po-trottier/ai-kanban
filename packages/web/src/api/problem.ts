import { z } from 'zod'

/**
 * RFC 9457 problem+json as produced by the server (docs/architecture/rest-api.md#conventions).
 * Extras (`rule`, `from`/`to`, the current card on 409) ride along untyped.
 */
export const problemDetailsSchema = z.looseObject({
  type: z.string().optional(),
  title: z.string().optional(),
  status: z.number().int().optional(),
  detail: z.string().optional(),
  issues: z
    .array(z.looseObject({ path: z.array(z.union([z.string(), z.number()])), message: z.string() }))
    .optional(),
})
export type ProblemDetails = z.infer<typeof problemDetailsSchema>

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
