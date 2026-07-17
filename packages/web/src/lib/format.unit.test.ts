import { describe, expect, it } from 'vitest'
import { formatEstimate, initials, isOverdueResume, utcToday } from './format.ts'

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

describe('utcToday', () => {
  it('formats the injected instant as a UTC date', () => {
    // Arrange
    const now = new Date('2026-07-16T23:59:00.000Z')
    // Act
    const result = utcToday(now)
    // Assert
    expect(result).toBe('2026-07-16')
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
