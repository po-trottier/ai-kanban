import { describe, expect, it } from 'vitest'
import { businessMinutesBetween, isOverdueResume, isWorkOverdue, utcDayOf } from './dates.ts'

describe('utcDayOf', () => {
  it('formats the instant as a UTC date', () => {
    // Arrange
    const instant = new Date('2026-07-16T23:59:00.000Z')

    // Act
    const result = utcDayOf(instant)

    // Assert
    expect(result).toBe('2026-07-16')
  })
})

describe('isOverdueResume', () => {
  it('is not overdue on the expected resume day itself', () => {
    // Arrange
    const expectedResumeAt = '2026-07-16'

    // Act
    const result = isOverdueResume(expectedResumeAt, '2026-07-16')

    // Assert
    expect(result).toBe(false)
  })

  it('is overdue starting the following UTC day', () => {
    // Arrange
    const expectedResumeAt = '2026-07-15'

    // Act
    const result = isOverdueResume(expectedResumeAt, '2026-07-16')

    // Assert
    expect(result).toBe(true)
  })

  it('is never overdue without a resume date', () => {
    // Arrange
    const expectedResumeAt = null

    // Act
    const result = isOverdueResume(expectedResumeAt, '2026-07-16')

    // Assert
    expect(result).toBe(false)
  })
})

describe('businessMinutesBetween', () => {
  // 2026-07-16 is a Thursday; 07-18/07-19 are Sat/Sun (used for weekend skips).

  it('counts only the 09:00–17:00 window within a single weekday', () => {
    // Arrange — 08:00 to 18:00 UTC on a Thursday clamps to the 8h window.
    const start = new Date('2026-07-16T08:00:00.000Z')
    const end = new Date('2026-07-16T18:00:00.000Z')

    // Act
    const minutes = businessMinutesBetween(start, end)

    // Assert — 8 business hours = 480 minutes.
    expect(minutes).toBe(480)
  })

  it('skips the weekend between two weekdays', () => {
    // Arrange — Friday 16:00 to Monday 10:00 UTC: 1h Fri + 1h Mon, no weekend.
    const start = new Date('2026-07-17T16:00:00.000Z')
    const end = new Date('2026-07-20T10:00:00.000Z')

    // Act
    const minutes = businessMinutesBetween(start, end)

    // Assert — 60 (Fri 16–17) + 60 (Mon 09–10) = 120.
    expect(minutes).toBe(120)
  })

  it('is zero when end is at or before start', () => {
    // Arrange
    const at = new Date('2026-07-16T12:00:00.000Z')
    const before = new Date('2026-07-16T13:00:00.000Z')

    // Act
    const equal = businessMinutesBetween(at, at)
    const reversed = businessMinutesBetween(before, at)

    // Assert
    expect(equal).toBe(0)
    expect(reversed).toBe(0)
  })

  it('counts zero business minutes across a full weekend', () => {
    // Arrange — all of Saturday into Sunday afternoon.
    const start = new Date('2026-07-18T00:00:00.000Z')
    const end = new Date('2026-07-19T18:00:00.000Z')

    // Act
    const minutes = businessMinutesBetween(start, end)

    // Assert
    expect(minutes).toBe(0)
  })

  it('honours a custom working day', () => {
    // Arrange — same 08:00–18:00 Thursday span, but an 08:00–18:00 (10h) day.
    const start = new Date('2026-07-16T08:00:00.000Z')
    const end = new Date('2026-07-16T18:00:00.000Z')

    // Act
    const minutes = businessMinutesBetween(start, end, { startHour: 8, endHour: 18 })

    // Assert — the whole 10h span now counts (600 minutes).
    expect(minutes).toBe(600)
  })
})

describe('isWorkOverdue', () => {
  const now = new Date('2026-07-16T15:00:00.000Z') // Thursday 15:00

  it('is overdue once elapsed business minutes reach the estimate', () => {
    // Arrange — started 09:00, now 15:00 → 360 business minutes elapsed.
    const workStartedAt = '2026-07-16T09:00:00.000Z'

    // Act — estimate met (360), exceeded (300), and not-yet (361).
    const met = isWorkOverdue(workStartedAt, 360, now)
    const exceeded = isWorkOverdue(workStartedAt, 300, now)
    const under = isWorkOverdue(workStartedAt, 361, now)

    // Assert
    expect(met).toBe(true)
    expect(exceeded).toBe(true)
    expect(under).toBe(false)
  })

  it('is never overdue without a start or without an estimate', () => {
    // Arrange
    const workStartedAt = '2026-07-16T09:00:00.000Z'

    // Act
    const noStart = isWorkOverdue(null, 60, now)
    const noEstimate = isWorkOverdue(workStartedAt, null, now)

    // Assert
    expect(noStart).toBe(false)
    expect(noEstimate).toBe(false)
  })
})
