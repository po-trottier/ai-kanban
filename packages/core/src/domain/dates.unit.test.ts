import { describe, expect, it } from 'vitest'
import { isOverdueResume, utcDayOf } from './dates.ts'

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
