import { LAST_ACTIVE_ADMIN_RULE } from '@rivian-kanban/core'

/**
 * Server-surface errors complementing core's domain taxonomy
 * (packages/core/src/domain/errors.ts). The problem+json mapper in
 * http/problems.ts is the single place they turn into responses.
 */

/** No/invalid session on a protected route (401). */
export class UnauthenticatedError extends Error {
  constructor() {
    super('authentication required')
    this.name = 'UnauthenticatedError'
  }
}

/**
 * Missing/invalid/revoked bearer token on /mcp (401 + `WWW-Authenticate:
 * Bearer`, docs/architecture/mcp.md#authentication). `tokenPresented`
 * selects the RFC 6750 challenge: a bare `Bearer` when no credential came at
 * all, `error="invalid_token"` when one did and was rejected.
 *
 * `resourceMetadataIssuer` is the AS issuer origin (ADR-021 §A): when present,
 * the challenge advertises the RFC 9728 `resource_metadata` URL so an OAuth
 * client can discover the authorization server and start the auth flow. Omitted
 * only for the internal "bearer hook did not run" invariant.
 */
export class BearerAuthRequiredError extends Error {
  readonly tokenPresented: boolean
  readonly resourceMetadataIssuer?: string

  constructor(detail: string, tokenPresented: boolean, resourceMetadataIssuer?: string) {
    super(detail)
    this.name = 'BearerAuthRequiredError'
    this.tokenPresented = tokenPresented
    if (resourceMetadataIssuer !== undefined) this.resourceMetadataIssuer = resourceMetadataIssuer
  }
}

/** Uniform login failure — unknown email and wrong password are identical (401). */
export class InvalidCredentialsError extends Error {
  constructor() {
    super('invalid email or password')
    this.name = 'InvalidCredentialsError'
  }
}

/** The logged-in user supplied a wrong current password on change-password (403). */
export class CurrentPasswordMismatchError extends Error {
  constructor() {
    super('current password is incorrect')
    this.name = 'CurrentPasswordMismatchError'
  }
}

/** The app-level global per-IP bucket is exhausted (429 + Retry-After). */
export class RateLimitExceededError extends Error {
  readonly retryAfterSeconds: number

  constructor(retryAfterSeconds: number) {
    super('rate limit exceeded — retry later')
    this.name = 'RateLimitExceededError'
    this.retryAfterSeconds = retryAfterSeconds
  }
}

/** Per-account exponential login backoff is active (429 + Retry-After). */
export class BackoffActiveError extends Error {
  readonly retryAfterSeconds: number

  constructor(retryAfterSeconds: number) {
    super('too many failed login attempts — retry later')
    this.name = 'BackoffActiveError'
    this.retryAfterSeconds = retryAfterSeconds
  }
}

/** New password violates the policy (length or common-password reject, 400). */
export class PasswordPolicyError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'PasswordPolicyError'
  }
}

/** Semantic request rejection beyond schema shape (e.g. tree hierarchy, 400). */
export class RequestValidationError extends Error {
  readonly path: string

  constructor(path: string, message: string) {
    super(message)
    this.name = 'RequestValidationError'
    this.path = path
  }
}

/** A temp password is set — only change-password/logout/me respond (403). */
export class MustChangePasswordError extends Error {
  constructor() {
    super('a temporary password is set — change it before doing anything else')
    this.name = 'MustChangePasswordError'
  }
}

/** Request missing the CSRF layer (JSON content type or X-Requested-With, 403). */
export class CsrfError extends Error {
  constructor() {
    super(
      'state-changing requests require Content-Type: application/json or an X-Requested-With header',
    )
    this.name = 'CsrfError'
  }
}

/** Upload sniffed to a MIME outside the allowlist (415). */
export class UnsupportedMediaTypeError extends Error {
  constructor(detected: string) {
    super(`unsupported file type: ${detected} (allowed: images and PDF)`)
    this.name = 'UnsupportedMediaTypeError'
  }
}

/** Daily upload quota or the blob-dir high-water mark was hit (507). */
export class StorageQuotaError extends Error {
  constructor(detail: string) {
    super(detail)
    this.name = 'StorageQuotaError'
  }
}

/** POST /setup after any non-system user exists — first-boot setup never reopens (409). */
export class SetupAlreadyCompleteError extends Error {
  constructor() {
    super('setup is already complete — a user account already exists')
    this.name = 'SetupAlreadyCompleteError'
  }
}

/** Demoting/deactivating the last active admin (409, named rule). */
export class LastActiveAdminError extends Error {
  readonly rule = LAST_ACTIVE_ADMIN_RULE

  constructor() {
    super('the last active admin cannot be demoted or deactivated')
    this.name = 'LastActiveAdminError'
  }
}
