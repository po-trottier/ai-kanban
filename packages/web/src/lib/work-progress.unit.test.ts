import { describe, expect, it } from 'vitest'
import {
  businessMinutesBetween,
  isBusinessHours,
  minutesUntilTargetDate,
  timerState,
  workProgress,
} from './work-progress.ts'

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

describe('isBusinessHours', () => {
  it('is true inside a weekday 09:00–17:00 window', () => {
    // Arrange — Thu 10:00 UTC
    const at = utc(2026, 1, 1, 10)
    // Act
    const inHours = isBusinessHours(at, 'UTC')
    // Assert
    expect(inHours).toBe(true)
  })

  it('is false before 09:00, at/after 17:00, and on weekends', () => {
    // Arrange — early, the exclusive end, and Saturday (2026-01-03)
    const early = utc(2026, 1, 1, 8)
    const end = utc(2026, 1, 1, 17)
    const saturday = utc(2026, 1, 3, 12)
    // Act
    const results = [early, end, saturday].map((at) => isBusinessHours(at, 'UTC'))
    // Assert
    expect(results).toEqual([false, false, false])
  })

  it('anchors the window to the viewer zone, not UTC', () => {
    // Arrange — 18:00 UTC is off-hours in UTC but 10:00 local business hours in LA (UTC-8).
    const at = utc(2026, 1, 1, 18)
    // Act
    const utcHours = isBusinessHours(at, 'UTC')
    const laHours = isBusinessHours(at, 'America/Los_Angeles')
    // Assert
    expect(utcHours).toBe(false)
    expect(laHours).toBe(true)
  })
})

describe('timerState', () => {
  const noContext = { waiting: false, blocked: false }

  it('runs inside business hours and pauses off-hours', () => {
    // Arrange — Thu 10:00 (in) vs Thu 20:00 (out)
    const inHours = utc(2026, 1, 1, 10)
    const offHours = utc(2026, 1, 1, 20)
    // Act
    const running = timerState(inHours, 'UTC', noContext)
    const paused = timerState(offHours, 'UTC', noContext)
    // Assert
    expect(running).toEqual({ running: true, reason: 'working' })
    expect(paused).toEqual({ running: false, reason: 'off_hours' })
  })

  it('keeps running (not a fake pause) while waiting or blocked, since accrual continues', () => {
    // Arrange — inside business hours; waiting and blocked are running reasons.
    const at = utc(2026, 1, 1, 10)
    // Act — blocked outranks waiting for the label
    const waiting = timerState(at, 'UTC', { waiting: true, blocked: false })
    const blocked = timerState(at, 'UTC', { waiting: true, blocked: true })
    // Assert
    expect(waiting).toEqual({ running: true, reason: 'waiting' })
    expect(blocked).toEqual({ running: true, reason: 'blocked' })
  })

  it('reports off-hours even when waiting/blocked (only business hours gate the clock)', () => {
    // Arrange — Thu 20:00, waiting+blocked
    const at = utc(2026, 1, 1, 20)
    // Act
    const state = timerState(at, 'UTC', { waiting: true, blocked: true })
    // Assert — off-hours wins: the clock is genuinely paused
    expect(state).toEqual({ running: false, reason: 'off_hours' })
  })
})

describe('minutesUntilTargetDate', () => {
  it('counts remaining business time to the end of the target day', () => {
    // Arrange — now Thu 09:00 UTC, target the SAME day: a full 8h business day.
    const now = utc(2026, 1, 1, 9)
    // Act
    const minutes = minutesUntilTargetDate('2026-01-01', now, 'UTC')
    // Assert — 09:00 to 17:00 = 480 business minutes
    expect(minutes).toBe(480)
  })

  it('sums whole business days and skips the weekend', () => {
    // Arrange — now Fri 09:00, target the next Monday: Fri (8h) + Mon (8h), Sat/Sun skipped.
    const now = utc(2026, 1, 2, 9)
    // Act
    const minutes = minutesUntilTargetDate('2026-01-05', now, 'UTC')
    // Assert — two full 8h days
    expect(minutes).toBe(960)
  })

  it('is zero when no business time remains before the target end (already after 17:00)', () => {
    // Arrange — now Thu 18:00, target today: the window already closed.
    const now = utc(2026, 1, 1, 18)
    // Act
    const minutes = minutesUntilTargetDate('2026-01-01', now, 'UTC')
    // Assert
    expect(minutes).toBe(0)
  })

  it('anchors the target end to the viewer zone', () => {
    // Arrange — now 2026-01-01 20:00 UTC = 12:00 local in LA (UTC-8); target same LA day.
    const now = utc(2026, 1, 1, 20)
    // Act
    const minutes = minutesUntilTargetDate('2026-01-01', now, 'America/Los_Angeles')
    // Assert — 12:00 to 17:00 local = 300 business minutes
    expect(minutes).toBe(300)
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
