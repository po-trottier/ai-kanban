import { randomBytes } from 'node:crypto'
import argon2 from 'argon2'

/**
 * argon2id hashing (docs/architecture/security.md#authentication).
 *
 * Production parameters follow the OWASP Password Storage Cheat Sheet
 * first-recommended argon2id configuration: 19 MiB memory, 2 iterations,
 * parallelism 1 (~40–80 ms per hash on server hardware — deliberate cost).
 * Tests inject cheaper parameters through the same constructor; the algorithm
 * and code paths are identical.
 */
export interface Argon2Params {
  /** KiB. */
  memoryCost: number
  timeCost: number
  parallelism: number
}

const PRODUCTION_ARGON2_PARAMS: Argon2Params = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
}

export class PasswordHasher {
  private readonly params: Argon2Params
  /** Lazily-built hash of unguessable randomness — verifying against it always fails. */
  private dummyHash: Promise<string> | null = null

  constructor(params: Argon2Params = PRODUCTION_ARGON2_PARAMS) {
    this.params = params
  }

  hash(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id, ...this.params })
  }

  /** False for wrong passwords AND for non-argon2 sentinels (seed placeholders). */
  async verify(storedHash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(storedHash, password)
    } catch {
      return false
    }
  }

  /**
   * Timing equalizer: verifies a static dummy hash when the email is unknown
   * so login latency does not enumerate users (security.md#authentication).
   */
  async verifyDummy(password: string): Promise<void> {
    this.dummyHash ??= this.hash(randomBytes(32).toString('base64url'))
    await this.verify(await this.dummyHash, password)
  }
}
