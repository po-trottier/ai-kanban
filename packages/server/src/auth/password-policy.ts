import { PASSWORD_MIN_LENGTH } from '@rivian-kanban/core'
import { COMMON_PASSWORDS } from './common-passwords.ts'

/**
 * Password policy (docs/architecture/security.md#authentication): 12–128
 * characters, no composition rules (NIST-style), top-10k common passwords
 * rejected case-insensitively. The minimum is the shared core constant so the
 * web form's inline validation cannot drift from the enforced policy.
 */

const PASSWORD_MAX_LENGTH = 128

/** The human-readable violation, or null when the password is acceptable. */
export function passwordPolicyViolation(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `password must be at least ${PASSWORD_MIN_LENGTH.toString()} characters`
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `password must be at most ${PASSWORD_MAX_LENGTH.toString()} characters`
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return 'password is too common'
  }
  return null
}
