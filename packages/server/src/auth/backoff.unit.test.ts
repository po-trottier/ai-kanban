import { FixedClock } from '@rivian-kanban/core/testing'
import { describe, expect, it } from 'vitest'
import { backoffDelayMs, LoginBackoff } from './backoff.ts'

describe('backoffDelayMs', () => {
  it('doubles from 1 s per failure and caps at 60 s', () => {
    // Arrange
    const failureCounts = [0, 1, 2, 3, 4, 5, 6, 7, 100]

    // Act
    const delays = failureCounts.map(backoffDelayMs)

    // Assert
    expect(delays).toEqual([0, 1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000])
  })
})

describe('LoginBackoff', () => {
  it('allows the first attempt and blocks immediately after a failure', () => {
    // Arrange
    const clock = new FixedClock()
    const backoff = new LoginBackoff(clock)

    // Act
    const before = backoff.retryAfterMs('user@example.com')
    backoff.recordFailure('user@example.com')
    const after = backoff.retryAfterMs('user@example.com')

    // Assert
    expect(before).toBe(0)
    expect(after).toBe(1_000)
  })

  it('keys accounts case-insensitively', () => {
    // Arrange
    const clock = new FixedClock()
    const backoff = new LoginBackoff(clock)

    // Act
    backoff.recordFailure('User@Example.com')

    // Assert
    expect(backoff.retryAfterMs('user@example.com')).toBe(1_000)
  })

  it('grows the delay per failure and clears it on reset', () => {
    // Arrange
    const clock = new FixedClock()
    const backoff = new LoginBackoff(clock)

    // Act
    backoff.recordFailure('user@example.com')
    backoff.recordFailure('user@example.com')
    const doubled = backoff.retryAfterMs('user@example.com')
    backoff.reset('user@example.com')
    const cleared = backoff.retryAfterMs('user@example.com')

    // Assert
    expect(doubled).toBe(2_000)
    expect(cleared).toBe(0)
  })

  it('expires the wait as the clock advances', () => {
    // Arrange
    const clock = new FixedClock('2026-07-16T12:00:00.000Z')
    const backoff = new LoginBackoff(clock)
    backoff.recordFailure('user@example.com')

    // Act
    clock.advanceDays(1)

    // Assert
    expect(backoff.retryAfterMs('user@example.com')).toBe(0)
  })

  it('caps tracked accounts with LRU eviction (junk emails cannot fill memory)', () => {
    // Arrange
    const clock = new FixedClock()
    const backoff = new LoginBackoff(clock, 2)

    // Act
    backoff.recordFailure('first@example.com')
    backoff.recordFailure('second@example.com')
    backoff.recordFailure('third@example.com')

    // Assert — the oldest entry was evicted, the two newest survive.
    expect(backoff.retryAfterMs('first@example.com')).toBe(0)
    expect(backoff.retryAfterMs('second@example.com')).toBe(1_000)
    expect(backoff.retryAfterMs('third@example.com')).toBe(1_000)
  })
})
