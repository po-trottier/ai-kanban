import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { OAuthError } from './oauth-errors.ts'
import { assertS256, verifyPkce } from './pkce.ts'

/** The RFC 7636 S256 challenge for a verifier: base64url(sha256(verifier)). */
function challengeFor(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

describe('assertS256', () => {
  it('accepts S256', () => {
    // Arrange
    const method = 'S256'

    // Act
    const act = (): void => {
      assertS256(method)
    }

    // Assert — the only allowed method returns without throwing.
    expect(act).not.toThrow()
  })

  it('rejects plain (the downgrade we explicitly refuse)', () => {
    // Arrange
    const method = 'plain'

    // Act
    const act = (): void => {
      assertS256(method)
    }

    // Assert
    expect(act).toThrow(OAuthError)
    expect(act).toThrow(/plain/)
  })

  it('rejects an absent method', () => {
    // Arrange
    const method = undefined

    // Act
    const act = (): void => {
      assertS256(method)
    }

    // Assert — undefined must be rejected, never defaulted to plain.
    expect(act).toThrow(OAuthError)
  })
})

describe('verifyPkce', () => {
  it('passes for the correct verifier', () => {
    // Arrange
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'

    // Act
    const ok = verifyPkce(verifier, challengeFor(verifier))

    // Assert
    expect(ok).toBe(true)
  })

  it('fails for a wrong verifier', () => {
    // Arrange — the stored challenge is for a DIFFERENT verifier.
    const challenge = challengeFor('the-real-verifier')

    // Act
    const ok = verifyPkce('a-different-verifier', challenge)

    // Assert
    expect(ok).toBe(false)
  })

  it('fails (no throw) when the stored challenge length differs from a real digest', () => {
    // Arrange — a truncated challenge can't equal a 43-char base64url digest.
    const challenge = 'too-short'

    // Act — the length guard must return false, never throw from timingSafeEqual.
    const act = (): boolean => verifyPkce('any-verifier', challenge)

    // Assert
    expect(act).not.toThrow()
    expect(act()).toBe(false)
  })

  it('compares equal-length buffers (constant-time path, no early return on mismatch)', () => {
    // Arrange — two DISTINCT valid challenges are both 43 base64url chars, so
    // the comparison takes the timingSafeEqual branch (equal length).
    const a = challengeFor('verifier-a')
    const b = challengeFor('verifier-b')

    // Act
    const ok = verifyPkce('verifier-a', b)

    // Assert — same length, different content ⇒ false via the constant-time path.
    expect(a.length).toBe(b.length)
    expect(ok).toBe(false)
  })
})
