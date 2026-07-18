import { describe, expect, it } from 'vitest'
import {
  estimateToMinutes,
  estimateToParts,
  formatDate,
  formatDateTime,
  formatEstimate,
  initials,
  isEstimateUnit,
} from './format.ts'

describe('formatEstimate', () => {
  it('renders sub-hour estimates in minutes', () => {
    // Arrange
    const minutes = 45
    // Act
    const result = formatEstimate(minutes)
    // Assert
    expect(result).toBe('45m')
  })

  it('renders 90 minutes as 1.5h (workflow.md example)', () => {
    // Arrange
    const minutes = 90
    // Act
    const result = formatEstimate(minutes)
    // Assert
    expect(result).toBe('1.5h')
  })

  it('renders 960 minutes as 2d with 1 day = 8 working hours (workflow.md example)', () => {
    // Arrange
    const minutes = 960
    // Act
    const result = formatEstimate(minutes)
    // Assert
    expect(result).toBe('2d')
  })

  it('renders a fractional day estimate with one decimal', () => {
    // Arrange
    const minutes = 720 // 12h = 1.5 working days
    // Act
    const result = formatEstimate(minutes)
    // Assert
    expect(result).toBe('1.5d')
  })
})

describe('estimateToParts', () => {
  it('splits whole working days into the days unit (960 → 2 days)', () => {
    // Arrange
    const minutes = 960
    // Act
    const parts = estimateToParts(minutes)
    // Assert
    expect(parts).toEqual({ value: 2, unit: 'days' })
  })

  it('splits whole hours into the hours unit (120 → 2 hours)', () => {
    // Arrange
    const minutes = 120
    // Act
    const parts = estimateToParts(minutes)
    // Assert
    expect(parts).toEqual({ value: 2, unit: 'hours' })
  })

  it('keeps a non-hour amount in minutes (45 → 45 minutes)', () => {
    // Arrange
    const minutes = 45
    // Act
    const parts = estimateToParts(minutes)
    // Assert
    expect(parts).toEqual({ value: 45, unit: 'minutes' })
  })
})

describe('estimateToMinutes', () => {
  it('converts days to minutes at 8 working hours per day (1.5d → 720)', () => {
    // Arrange
    const value = 1.5
    // Act
    const minutes = estimateToMinutes(value, 'days')
    // Assert
    expect(minutes).toBe(720)
  })

  it('converts hours to whole minutes (1.5h → 90)', () => {
    // Arrange
    const value = 1.5
    // Act
    const minutes = estimateToMinutes(value, 'hours')
    // Assert
    expect(minutes).toBe(90)
  })

  it('round-trips through estimateToParts for every unit boundary', () => {
    // Arrange
    const samples = [45, 90, 120, 720, 960]
    // Act
    const roundTripped = samples.map((minutes) => {
      const { value, unit } = estimateToParts(minutes)
      return estimateToMinutes(value, unit)
    })
    // Assert
    expect(roundTripped).toEqual(samples)
  })
})

describe('isEstimateUnit', () => {
  it('accepts a known unit and rejects an unknown one', () => {
    // Arrange
    const known = 'days'
    const unknown = 'weeks'
    // Act
    const results = [isEstimateUnit(known), isEstimateUnit(unknown)]
    // Assert
    expect(results).toEqual([true, false])
  })
})

describe('formatDate', () => {
  it('renders a short month-and-day resume cue', () => {
    // Arrange
    const iso = '2026-07-20'
    // Act
    const result = formatDate(iso)
    // Assert
    expect(result).toBe('Jul 20')
  })
})

describe('formatDateTime', () => {
  it('renders an instant in the given time zone', () => {
    // Arrange — the same UTC instant read from two different zones
    const iso = '2026-07-20T02:30:00.000Z'
    // Act
    const utc = formatDateTime(iso, 'UTC')
    const la = formatDateTime(iso, 'America/Los_Angeles')
    // Assert — 02:30Z is 19:30 the previous day in Los Angeles (PDT, UTC-7)
    expect(utc).toBe('Jul 20, 2026 02:30')
    expect(la).toBe('Jul 19, 2026 19:30')
  })
})

describe('initials', () => {
  it('takes the first letters of the first two words, uppercased', () => {
    // Arrange
    const name = 'ada lovelace jones'
    // Act
    const result = initials(name)
    // Assert
    expect(result).toBe('AL')
  })
})
