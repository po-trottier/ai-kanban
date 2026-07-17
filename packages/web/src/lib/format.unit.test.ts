import { describe, expect, it } from 'vitest'
import { formatEstimate, initials } from './format.ts'

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
