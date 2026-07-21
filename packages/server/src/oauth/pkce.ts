import { createHash, timingSafeEqual } from 'node:crypto'
import { OAuthError } from './oauth-errors.ts'

/**
 * PKCE verification (OAuth 2.1, ADR-021 security) — S256 ONLY. `plain` is a
 * downgrade that lets a network attacker who captured the challenge forge the
 * verifier, so we reject anything but `S256` outright rather than support it.
 */

/**
 * Rejects any code-challenge method other than `S256` (in particular `plain`
 * and an absent/undefined method). Throws `invalid_request` — the token
 * endpoint maps it to 400.
 */
export function assertS256(method: string | undefined): void {
  if (method !== 'S256') {
    throw new OAuthError(
      'invalid_request',
      `unsupported code_challenge_method: ${method ?? 'none'}`,
    )
  }
}

/**
 * Constant-time PKCE check: `base64url(sha256(codeVerifier))` must equal the
 * stored `codeChallenge`. Uses `timingSafeEqual` so a mismatch leaks no timing
 * signal; unequal-length buffers can't go into `timingSafeEqual` (it throws),
 * so we length-check first and return false — itself not a secret-dependent
 * branch (the computed digest is always 43 base64url chars, so a length
 * mismatch means a malformed stored challenge, not a guess oracle).
 */
export function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
  const computed = createHash('sha256').update(codeVerifier).digest('base64url')
  const a = Buffer.from(computed)
  const b = Buffer.from(codeChallenge)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
