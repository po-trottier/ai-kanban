import { describe, expect, it } from 'vitest'
import { businessMinutesBetween, workProgress } from './work-progress.ts'

/** UTC instant helper. 2026-01-01 is a Thursday, so 01/02 = Fri, 01/05 = Mon. */
function utc(year: number, month: number, day: number, hour: number, minute = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute, 0))
}

describe('businessMinutesBetween', () => {
  it('counts minutes inside a single business day', () => {
    // Arrange
    const start = utc(2026, 1, 1, 10) // Thu 10:00
    const end = utc(2026, 1, 1, 12) // Thu 12:00
    // Act
    const minutes = businessMinutesBetween(start, end, 'UTC')
    // Assert
    expect(minutes).toBe(120)
  })

  it('clamps to the 09:00–17:00 window (8 business hours max per day)', () => {
    // Arrange — 08:00 to 18:00 spans the whole day but only 9–17 counts
    const start = utc(2026, 1, 1, 8)
    const end = utc(2026, 1, 1, 18)
    // Act
    const minutes = businessMinutesBetween(start, end, 'UTC')
    // Assert
    expect(minutes).toBe(480)
  })

  it('skips weekends', () => {
    // Arrange — Fri 16:00 → Mon 10:00: Fri 16–17 (60) + Mon 9–10 (60), nothing Sat/Sun
    const start = utc(2026, 1, 2, 16)
    const end = utc(2026, 1, 5, 10)
    // Act
    const minutes = businessMinutesBetween(start, end, 'UTC')
    // Assert
    expect(minutes).toBe(120)
  })

  it('sums across consecutive business days', () => {
    // Arrange — Thu 09:00 → Fri 17:00: two full 8h days
    const start = utc(2026, 1, 1, 9)
    const end = utc(2026, 1, 2, 17)
    // Act
    const minutes = businessMinutesBetween(start, end, 'UTC')
    // Assert
    expect(minutes).toBe(960)
  })

  it('is zero when end is at or before start', () => {
    // Arrange
    const start = utc(2026, 1, 1, 12)
    // Act
    const same = businessMinutesBetween(start, start, 'UTC')
    const reversed = businessMinutesBetween(start, utc(2026, 1, 1, 11), 'UTC')
    // Assert
    expect(same).toBe(0)
    expect(reversed).toBe(0)
  })

  it('ignores time spent entirely outside business hours', () => {
    // Arrange — Thu 18:00 → Thu 23:00 (all after 17:00)
    const start = utc(2026, 1, 1, 18)
    const end = utc(2026, 1, 1, 23)
    // Act
    const minutes = businessMinutesBetween(start, end, 'UTC')
    // Assert
    expect(minutes).toBe(0)
  })

  it('anchors the business window to the viewer time zone, not UTC', () => {
    // Arrange — Thu 18:00–20:00 UTC is after-hours in UTC (0 min), but in
    // Los Angeles (UTC-8) that is 10:00–12:00 local, squarely business hours.
    const start = utc(2026, 1, 1, 18)
    const end = utc(2026, 1, 1, 20)
    // Act
    const utcMinutes = businessMinutesBetween(start, end, 'UTC')
    const laMinutes = businessMinutesBetween(start, end, 'America/Los_Angeles')
    // Assert
    expect(utcMinutes).toBe(0)
    expect(laMinutes).toBe(120)
  })
})

describe('workProgress', () => {
  it('reports the partway percentage before the estimate is spent', () => {
    // Arrange — started Thu 10:00, now Thu 11:00 (60 business min) of a 120 min estimate
    const startedAt = utc(2026, 1, 1, 10).toISOString()
    // Act
    const progress = workProgress(startedAt, 120, utc(2026, 1, 1, 11), 'UTC')
    // Assert
    expect(progress).toEqual({ percent: 50, overdue: false, elapsedMinutes: 60 })
  })

  it('caps at 100% and flags overdue once elapsed meets the estimate', () => {
    // Arrange — started Thu 09:00, now Thu 11:00 (120 business min) of a 60 min estimate
    const startedAt = utc(2026, 1, 1, 9).toISOString()
    // Act
    const progress = workProgress(startedAt, 60, utc(2026, 1, 1, 11), 'UTC')
    // Assert
    expect(progress.percent).toBe(100)
    expect(progress.overdue).toBe(true)
    expect(progress.elapsedMinutes).toBe(120)
  })

  it('treats a non-positive estimate as immediately overdue', () => {
    // Arrange
    const startedAt = utc(2026, 1, 1, 10).toISOString()
    // Act
    const progress = workProgress(startedAt, 0, utc(2026, 1, 1, 10, 30), 'UTC')
    // Assert
    expect(progress.overdue).toBe(true)
    expect(progress.percent).toBe(100)
  })
})
