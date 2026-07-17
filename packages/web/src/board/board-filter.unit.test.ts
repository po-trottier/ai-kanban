import { describe, expect, it } from 'vitest'
import { makeBoard, makeCard, withCardExtras } from '../test/fixtures.ts'
import { filterBoard } from './board-filter.ts'

describe('filterBoard', () => {
  it('returns the board unchanged for a blank query (no filtering)', () => {
    // Arrange
    const a = makeCard('intake', { title: 'Fix pump' })
    const b = makeCard('ready', { title: 'Change filter' })
    const board = makeBoard({ intake: [a], ready: [b] })
    // Act
    const result = filterBoard(board, '   ')
    // Assert — same reference (no work) so the board renders identically.
    expect(result.board).toBe(board)
    expect(result.active).toBe(false)
  })

  it('keeps only cards whose title contains the query (case-insensitive)', () => {
    // Arrange
    const hit = makeCard('intake', { title: 'Leaking Faucet' })
    const miss = makeCard('intake', { title: 'Broken window' })
    const board = makeBoard({ intake: [hit, miss] })
    // Act
    const result = filterBoard(board, 'faucet')
    // Assert
    const intake = result.board.lanes.find((snapshot) => snapshot.lane.key === 'intake')
    expect(intake?.cards.map((card) => card.id)).toEqual([hit.id])
    expect(result.active).toBe(true)
  })

  it('matches on tags carried by the board payload', () => {
    // Arrange
    const tagged = withCardExtras(makeCard('ready', { title: 'Inspect duct' }), {
      tags: ['HVAC', 'urgent'],
    })
    const plain = makeCard('ready', { title: 'Replace bulb' })
    const board = makeBoard({ ready: [tagged, plain] })
    // Act
    const result = filterBoard(board, 'hvac')
    // Assert
    const ready = result.board.lanes.find((snapshot) => snapshot.lane.key === 'ready')
    expect(ready?.cards.map((card) => card.id)).toEqual([tagged.id])
  })

  it('matches on the location label carried by the board payload', () => {
    // Arrange
    const located = withCardExtras(makeCard('ready', { title: 'Sweep floor' }), {
      locationLabel: 'Dock 3',
    })
    const plain = makeCard('ready', { title: 'Empty bins' })
    const board = makeBoard({ ready: [located, plain] })
    // Act
    const result = filterBoard(board, 'dock')
    // Assert
    const ready = result.board.lanes.find((snapshot) => snapshot.lane.key === 'ready')
    expect(ready?.cards.map((card) => card.id)).toEqual([located.id])
  })

  it('keeps every lane visible and reports per-lane match counts', () => {
    // Arrange
    const hit = makeCard('intake', { title: 'Roof leak' })
    const miss = makeCard('ready', { title: 'Paint wall' })
    const board = makeBoard({ intake: [hit], ready: [miss] })
    // Act
    const result = filterBoard(board, 'leak')
    // Assert — all 7 lanes stay in the snapshot; ready is now empty of matches.
    expect(result.board.lanes).toHaveLength(board.lanes.length)
    const ready = result.board.lanes.find((snapshot) => snapshot.lane.key === 'ready')
    expect(ready?.cards).toEqual([])
    // wipLimitExceeded recomputes off the filtered subset (never over-limit).
    expect(ready?.wipLimitExceeded).toBe(false)
  })
})
