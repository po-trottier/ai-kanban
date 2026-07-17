import { describe, expect, it } from 'vitest'
import { passwordPolicyViolation } from './password-policy.ts'

describe('passwordPolicyViolation', () => {
  it('accepts a 12+ char uncommon password with no composition rules', () => {
    // Arrange
    const password = 'lowercase only spaces ok'

    // Act
    const violation = passwordPolicyViolation(password)

    // Assert
    expect(violation).toBeNull()
  })

  it('rejects passwords under 12 characters', () => {
    // Arrange
    const password = 'elevenchars'

    // Act
    const violation = passwordPolicyViolation(password)

    // Assert
    expect(violation).toMatch(/at least 12/)
  })

  it('accepts exactly 12 and exactly 128 characters (boundaries)', () => {
    // Arrange
    const at12 = 'x'.repeat(12)
    const at128 = 'x'.repeat(128)

    // Act
    const low = passwordPolicyViolation(at12)
    const high = passwordPolicyViolation(at128)

    // Assert
    expect(low).toBeNull()
    expect(high).toBeNull()
  })

  it('rejects passwords over 128 characters', () => {
    // Arrange
    const password = 'x'.repeat(129)

    // Act
    const violation = passwordPolicyViolation(password)

    // Assert
    expect(violation).toMatch(/at most 128/)
  })

  it('rejects top-10k common passwords case-insensitively', () => {
    // Arrange — 'unbelievable' ships in the embedded SecLists 10k.
    const password = 'UnBeLiEvAbLe'

    // Act
    const violation = passwordPolicyViolation(password)

    // Assert
    expect(violation).toMatch(/too common/)
  })
})
