import {
  ArchivedError,
  ConflictError,
  IllegalTransitionError,
  LimitExceededError,
  MAX_ATTACHMENT_BYTES,
  NotFoundError,
  PolicyDeniedError,
} from '@rivian-kanban/core'
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod'
import { ZodError } from 'zod'
import {
  BackoffActiveError,
  CsrfError,
  CurrentPasswordMismatchError,
  InvalidCredentialsError,
  LastActiveAdminError,
  MustChangePasswordError,
  PasswordPolicyError,
  RateLimitExceededError,
  RequestValidationError,
  StorageQuotaError,
  UnauthenticatedError,
  UnsupportedMediaTypeError,
} from '../errors.ts'

/**
 * RFC 9457 problem+json mapping (docs/architecture/rest-api.md#conventions).
 * One pure function turns any thrown error into `{ status, body, headers }`;
 * the Fastify error handler only transports the result. Unknown errors become
 * a sanitized 500 — stacks and internal messages never leak.
 */

interface ProblemBody {
  /** Short URN identifying the problem class (RFC 9457 type URI-reference). */
  type: string
  title: string
  status: number
  detail?: string
  [extra: string]: unknown
}

export interface ProblemResult {
  status: number
  body: ProblemBody
  headers?: Record<string, string>
}

export const PROBLEM_CONTENT_TYPE = 'application/problem+json'

function problem(
  status: number,
  code: string,
  title: string,
  detail?: string,
  extras?: Record<string, unknown>,
): ProblemResult {
  return {
    status,
    body: {
      type: `urn:rivian-kanban:problem:${code}`,
      title,
      status,
      ...(detail !== undefined ? { detail } : {}),
      ...extras,
    },
  }
}

interface ValidationIssue {
  path: string
  message: string
}

function validationProblem(issues: ValidationIssue[]): ProblemResult {
  return problem(400, 'validation', 'Validation failed', 'the request did not match the schema', {
    issues,
  })
}

/** Errors fastify itself raises (body parsing, content type, rate limit…). */
function isFastifyHttpError(
  error: unknown,
): error is Error & { statusCode: number; code?: string } {
  return (
    error instanceof Error &&
    'statusCode' in error &&
    typeof error.statusCode === 'number' &&
    error.statusCode >= 400
  )
}

export function toProblem(error: unknown): ProblemResult {
  if (hasZodFastifySchemaValidationErrors(error)) {
    return validationProblem(
      error.validation.map((issue) => ({
        path: `${error.validationContext ?? 'request'}${issue.instancePath}`,
        message: issue.message ?? 'invalid',
      })),
    )
  }
  if (error instanceof ZodError) {
    return validationProblem(
      error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    )
  }
  if (error instanceof RequestValidationError) {
    return validationProblem([{ path: error.path, message: error.message }])
  }
  if (error instanceof PasswordPolicyError) {
    return problem(400, 'password-policy', 'Password rejected', error.message)
  }
  if (error instanceof UnauthenticatedError || error instanceof InvalidCredentialsError) {
    // Uniform wording: unknown email and wrong password are indistinguishable.
    return problem(401, 'unauthenticated', 'Authentication required', error.message)
  }
  if (error instanceof CurrentPasswordMismatchError) {
    return problem(403, 'invalid-current-password', 'Current password incorrect', error.message)
  }
  if (error instanceof MustChangePasswordError) {
    return problem(403, 'password-change-required', 'Password change required', error.message)
  }
  if (error instanceof CsrfError) {
    return problem(403, 'csrf', 'Cross-site request rejected', error.message)
  }
  if (error instanceof PolicyDeniedError) {
    return problem(403, 'policy-denied', 'Not allowed by the active policy', error.message, {
      rule: error.rule,
    })
  }
  if (error instanceof NotFoundError) {
    return problem(404, 'not-found', 'Resource not found', error.message)
  }
  if (error instanceof ArchivedError) {
    return problem(409, 'card-archived', 'Card is archived', error.message)
  }
  if (error instanceof LastActiveAdminError) {
    return problem(409, 'last-active-admin', 'Last active admin', error.message, {
      rule: error.rule,
    })
  }
  if (error instanceof ConflictError) {
    return problem(409, 'conflict', 'Conflict', error.message, {
      ...(error.current !== undefined ? { current: error.current } : {}),
    })
  }
  if (error instanceof LimitExceededError) {
    // The 25 MB file cap is a 413; every other limit (10 active files) is a
    // 409 attachment-limit conflict (docs/architecture/rest-api.md).
    if (error.limit === MAX_ATTACHMENT_BYTES) {
      return problem(413, 'payload-too-large', 'Upload too large', error.message)
    }
    return problem(409, 'attachment-limit', 'Attachment limit reached', error.message, {
      limit: error.limit,
    })
  }
  if (error instanceof UnsupportedMediaTypeError) {
    return problem(415, 'unsupported-media-type', 'Unsupported media type', error.message)
  }
  if (error instanceof IllegalTransitionError) {
    return problem(422, 'illegal-transition', 'Illegal lane transition', error.message, {
      from: error.from,
      to: error.to,
    })
  }
  if (error instanceof BackoffActiveError) {
    return {
      ...problem(429, 'login-backoff', 'Too many failed attempts', error.message, {
        retryAfterSeconds: error.retryAfterSeconds,
      }),
      headers: { 'retry-after': String(error.retryAfterSeconds) },
    }
  }
  if (error instanceof RateLimitExceededError) {
    return {
      ...problem(429, 'rate-limited', 'Too many requests', error.message),
      headers: { 'retry-after': String(error.retryAfterSeconds) },
    }
  }
  if (error instanceof StorageQuotaError) {
    return problem(507, 'insufficient-storage', 'Storage quota exceeded', error.message)
  }
  if (isFastifyHttpError(error)) {
    // Framework-raised HTTP errors: 413 body cap, 415 content type, 429 rate
    // limit, 400 malformed body… — trusted messages, sanitized 5xx.
    const status = error.statusCode
    if (error.code === 'FST_REQ_FILE_TOO_LARGE') {
      // @fastify/multipart's fileSize cap equals MAX_ATTACHMENT_BYTES, so an
      // oversized upload dies here first — same documented problem type as
      // core's own LimitExceededError 413 (docs/architecture/rest-api.md).
      return problem(413, 'payload-too-large', 'Upload too large', error.message)
    }
    if (status >= 500) return problem(status, 'internal', 'Internal server error')
    if (status === 429) {
      return problem(429, 'rate-limited', 'Too many requests', error.message)
    }
    return problem(status, `http-${String(status)}`, error.name, error.message)
  }
  return problem(500, 'internal', 'Internal server error')
}
