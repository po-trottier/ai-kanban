import { describe, expect, it } from 'vitest'
import { SystemClock } from './system-clock.ts'
import { Uuidv7IdGenerator } from './uuidv7-id-generator.ts'

describe('SystemClock', () => {
  it('returns the current wall time', () => {
    // Arrange
    const clock = new SystemClock()
    const before = Date.now()

    // Act
    const now = clock.now()

    // Assert
    expect(now.getTime()).toBeGreaterThanOrEqual(before)
    expect(now.getTime()).toBeLessThanOrEqual(Date.now())
  })
})

describe('Uuidv7IdGenerator', () => {
  it('produces distinct, time-ordered UUIDv7 ids', () => {
    // Arrange
    const generator = new Uuidv7IdGenerator()

    // Act
    const first = generator.newId()
    const second = generator.newId()

    // Assert
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(second).not.toBe(first)
    expect(second > first).toBe(true)
  })
})
