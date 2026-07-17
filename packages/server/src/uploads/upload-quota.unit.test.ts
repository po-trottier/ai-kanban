import { FixedClock } from '@rivian-kanban/core/testing'
import { describe, expect, it } from 'vitest'
import { UploadQuota } from './upload-quota.ts'

describe('UploadQuota', () => {
  it('reserves uploads up to the daily limit and rejects past it', () => {
    // Arrange
    const quota = new UploadQuota(new FixedClock(), 100)

    // Act
    const first = quota.reserve('user-1', 60)
    const exact = quota.reserve('user-1', 40)
    const over = quota.reserve('user-1', 1)

    // Assert
    expect(first).toBe(true)
    expect(exact).toBe(true)
    expect(over).toBe(false)
  })

  it('counts the reservation immediately — no check/record gap to race', () => {
    // Arrange
    const quota = new UploadQuota(new FixedClock(), 100)

    // Act: two "concurrent" uploads reserve back to back, before either
    // upload settles — the second must already see the first's bytes.
    const first = quota.reserve('user-1', 60)
    const second = quota.reserve('user-1', 60)

    // Assert
    expect(first).toBe(true)
    expect(second).toBe(false)
  })

  it('release refunds a failed upload, clamped at zero', () => {
    // Arrange
    const quota = new UploadQuota(new FixedClock(), 100)
    quota.reserve('user-1', 80)

    // Act
    quota.release('user-1', 80)
    quota.release('user-1', 9_999)

    // Assert
    expect(quota.reserve('user-1', 100)).toBe(true)
  })

  it('tracks users independently', () => {
    // Arrange
    const quota = new UploadQuota(new FixedClock(), 100)
    quota.reserve('user-1', 100)

    // Act
    const other = quota.reserve('user-2', 100)

    // Assert
    expect(other).toBe(true)
  })

  it('resets at the UTC day boundary', () => {
    // Arrange
    const clock = new FixedClock('2026-07-16T23:59:00.000Z')
    const quota = new UploadQuota(clock, 100)
    quota.reserve('user-1', 100)

    // Act
    clock.advanceDays(1)

    // Assert
    expect(quota.reserve('user-1', 100)).toBe(true)
  })
})
