import { type Clock } from '@rivian-kanban/core'
import { describe, expect, it } from 'vitest'
import { SlidingWindowLimiter } from './throttle.ts'

/** Hand-written fake Clock (docs/dev/testing.md: time is a port). */
class FixedClock implements Clock {
  private at: Date

  constructor(startIso: string) {
    this.at = new Date(startIso)
  }

  now(): Date {
    return this.at
  }

  advance(ms: number): void {
    this.at = new Date(this.at.getTime() + ms)
  }
}

describe('SlidingWindowLimiter', () => {
  it('allows exactly the limit within one window, then rejects', () => {
    // Arrange
    const clock = new FixedClock('2026-07-16T12:00:00.000Z')
    const limiter = new SlidingWindowLimiter(clock, 3, 60_000)

    // Act
    const first = limiter.tryAcquire('U1')
    const second = limiter.tryAcquire('U1')
    const third = limiter.tryAcquire('U1')
    const fourth = limiter.tryAcquire('U1')

    // Assert
    expect([first, second, third, fourth]).toEqual([true, true, true, false])
  })

  it('frees capacity as the window slides past old hits', () => {
    // Arrange
    const clock = new FixedClock('2026-07-16T12:00:00.000Z')
    const limiter = new SlidingWindowLimiter(clock, 2, 60_000)
    limiter.tryAcquire('U1')
    clock.advance(30_000)
    limiter.tryAcquire('U1')

    // Act
    const whileFull = limiter.tryAcquire('U1')
    clock.advance(30_001) // the first hit is now outside the window
    const afterSlide = limiter.tryAcquire('U1')
    const fullAgain = limiter.tryAcquire('U1')

    // Assert
    expect([whileFull, afterSlide, fullAgain]).toEqual([false, true, false])
  })

  it('tracks each key independently', () => {
    // Arrange
    const clock = new FixedClock('2026-07-16T12:00:00.000Z')
    const limiter = new SlidingWindowLimiter(clock, 1, 60_000)

    // Act
    const userA = limiter.tryAcquire('U1')
    const userARejected = limiter.tryAcquire('U1')
    const userB = limiter.tryAcquire('U2')

    // Assert
    expect([userA, userARejected, userB]).toEqual([true, false, true])
  })

  it('treats a zero limit as always exhausted (test/off switch semantics)', () => {
    // Arrange
    const clock = new FixedClock('2026-07-16T12:00:00.000Z')
    const limiter = new SlidingWindowLimiter(clock, 0, 60_000)

    // Act
    const acquired = limiter.tryAcquire('U1')

    // Assert
    expect(acquired).toBe(false)
  })
})
