import { describe, expect, it } from 'vitest'
import { BoundedLruSet } from './dedup.ts'

describe('BoundedLruSet', () => {
  it('accepts a new id once and flags every repeat as duplicate', () => {
    // Arrange
    const set = new BoundedLruSet(10)

    // Act
    const first = set.addIfAbsent('Ev001')
    const repeat = set.addIfAbsent('Ev001')
    const other = set.addIfAbsent('Ev002')

    // Assert
    expect([first, repeat, other]).toEqual([true, false, true])
  })

  it('evicts the least-recently-seen id once capacity is exceeded', () => {
    // Arrange
    const set = new BoundedLruSet(2)
    set.addIfAbsent('Ev001')
    set.addIfAbsent('Ev002')

    // Act
    set.addIfAbsent('Ev003') // evicts Ev001
    const evictedComesBack = set.addIfAbsent('Ev001')
    const survivorStillKnown = set.addIfAbsent('Ev003')

    // Assert
    expect(evictedComesBack).toBe(true)
    expect(survivorStillKnown).toBe(false)
  })

  it('refreshes recency on duplicates so hot ids outlive cold ones', () => {
    // Arrange
    const set = new BoundedLruSet(2)
    set.addIfAbsent('Ev001')
    set.addIfAbsent('Ev002')

    // Act
    set.addIfAbsent('Ev001') // duplicate refresh: Ev002 is now oldest
    set.addIfAbsent('Ev003') // evicts Ev002
    const hotStillKnown = set.addIfAbsent('Ev001')
    const coldEvicted = set.addIfAbsent('Ev002')

    // Assert
    expect(hotStillKnown).toBe(false)
    expect(coldEvicted).toBe(true)
  })

  it('rejects a nonsensical capacity', () => {
    // Arrange
    const capacity = 0

    // Act
    const act = () => new BoundedLruSet(capacity)

    // Assert
    expect(act).toThrow(/capacity/)
  })
})
