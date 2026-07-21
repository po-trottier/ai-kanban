/**
 * OAuth 2.1 protocol error (RFC 6749 §5.2), thrown by the authorization-server
 * services. `code` is the RFC error code (`invalid_grant`, `invalid_request`,
 * `invalid_client`, `invalid_redirect_uri`); slice-4's token/authorize/register
 * routes render it as the `{ error, error_description }` body with the right
 * status. One class, not a taxonomy — every failure the AS surfaces is one of
 * these RFC codes.
 *
 * SECURITY: `invalid_grant` is deliberately uniform — a consumed/expired code, a
 * PKCE mismatch, and a client/redirect mismatch all surface the same code so an
 * attacker can't distinguish which check failed (no oracle).
 */
export type OAuthErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'invalid_redirect_uri'
  | 'unsupported_grant_type'

export class OAuthError extends Error {
  readonly code: OAuthErrorCode

  constructor(code: OAuthErrorCode, description: string) {
    super(description)
    this.name = 'OAuthError'
    this.code = code
  }
}
