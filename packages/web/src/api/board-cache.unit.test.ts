import { describe, expect, it } from 'vitest'
import { makeBoard, makeCard } from '../test/fixtures.ts'
import { applyMoveToBoard, laneKeyOfCard, restoreIntentForCard } from './board-cache.ts'

describe('applyMoveToBoard', () => {
  it('moves a card between lanes after the given neighbor', () => {
    // Arrange
    const a = makeCard('ready')
    const b = makeCard('ready')
    const moving = makeCard('intake')
    const board = makeBoard({ intake: [moving], ready: [a, b] })
    // Act
    const next = applyMoveToBoard(board, moving.id, {
      toLane: 'ready',
      prevCardId: a.id,
      nextCardId: b.id,
    })
    // Assert
    const ready = next.lanes.find((snapshot) => snapshot.lane.key === 'ready')
    const intake = next.lanes.find((snapshot) => snapshot.lane.key === 'intake')
    expect(ready?.cards.map((card) => card.id)).toEqual([a.id, moving.id, b.id])
    expect(intake?.cards).toEqual([])
    expect(ready?.cards[1]?.laneId).toBe(ready?.lane.id)
  })

  it('reorders within a lane to the top when prev is null', () => {
    // Arrange
    const a = makeCard('ready')
    const b = makeCard('ready')
    const board = makeBoard({ ready: [a, b] })
    // Act
    const next = applyMoveToBoard(board, b.id, {
      toLane: 'ready',
      prevCardId: null,
      nextCardId: a.id,
    })
    // Assert
    const ready = next.lanes.find((snapshot) => snapshot.lane.key === 'ready')
    expect(ready?.cards.map((card) => card.id)).toEqual([b.id, a.id])
  })

  it('recomputes the soft WIP flag on the destination lane', () => {
    // Arrange — in_progress fixture WIP limit is 3
    const inProgress = [makeCard('in_progress'), makeCard('in_progress'), makeCard('in_progress')]
    const moving = makeCard('ready')
    const board = makeBoard({ ready: [moving], in_progress: inProgress })
    // Act
    const next = applyMoveToBoard(board, moving.id, {
      toLane: 'in_progress',
      prevCardId: inProgress[2]?.id ?? null,
      nextCardId: null,
    })
    // Assert
    const lane = next.lanes.find((snapshot) => snapshot.lane.key === 'in_progress')
    expect(lane?.cards).toHaveLength(4)
    expect(lane?.wipLimitExceeded).toBe(true)
  })

  it('sets waiting fields on entry into the waiting lane and clears them on exit', () => {
    // Arrange
    const waiting = makeCard('waiting_parts_vendor', {
      waitingReason: 'parts',
      expectedResumeAt: '2026-08-01',
    })
    const board = makeBoard({ waiting_parts_vendor: [waiting] })
    // Act
    const out = applyMoveToBoard(board, waiting.id, {
      toLane: 'in_progress',
      prevCardId: null,
      nextCardId: null,
    })
    // Assert
    const lane = out.lanes.find((snapshot) => snapshot.lane.key === 'in_progress')
    expect(lane?.cards[0]?.waitingReason).toBeNull()
    expect(lane?.cards[0]?.expectedResumeAt).toBeNull()
  })

  it('appends to the lane end when neighbors vanished (stale snapshot)', () => {
    // Arrange
    const a = makeCard('ready')
    const moving = makeCard('intake')
    const board = makeBoard({ intake: [moving], ready: [a] })
    // Act
    const next = applyMoveToBoard(board, moving.id, {
      toLane: 'ready',
      prevCardId: makeCard('done').id, // not present in ready
      nextCardId: null,
    })
    // Assert
    const ready = next.lanes.find((snapshot) => snapshot.lane.key === 'ready')
    expect(ready?.cards.map((card) => card.id)).toEqual([a.id, moving.id])
  })
})

describe('laneKeyOfCard', () => {
  it('resolves the lane key from the card lane id', () => {
    // Arrange
    const card = makeCard('review')
    const board = makeBoard({ review: [card] })
    // Act
    const key = laneKeyOfCard(board, card)
    // Assert
    expect(key).toBe('review')
  })
})

describe('restoreIntentForCard', () => {
  it('captures the current lane + immediate neighbors as the inverse move', () => {
    // Arrange — the middle card in a three-card lane
    const a = makeCard('ready')
    const b = makeCard('ready')
    const c = makeCard('ready')
    const board = makeBoard({ ready: [a, b, c] })
    // Act
    const intent = restoreIntentForCard(board, b.id)
    // Assert — moving b back between a and c restores its exact position
    expect(intent).toEqual({ toLane: 'ready', prevCardId: a.id, nextCardId: c.id })
  })

  it('uses null neighbors at the lane ends', () => {
    // Arrange
    const a = makeCard('intake')
    const b = makeCard('intake')
    const board = makeBoard({ intake: [a, b] })
    // Act — the first card has no prev, the last has no next
    const firstIntent = restoreIntentForCard(board, a.id)
    const lastIntent = restoreIntentForCard(board, b.id)
    // Assert
    expect(firstIntent).toEqual({ toLane: 'intake', prevCardId: null, nextCardId: b.id })
    expect(lastIntent).toEqual({ toLane: 'intake', prevCardId: a.id, nextCardId: null })
  })

  it('re-carries the waiting reason + resume date so a move back into the waiting lane is accepted', () => {
    // Arrange
    const waiting = makeCard('waiting_parts_vendor', {
      waitingReason: 'parts',
      expectedResumeAt: '2026-08-01',
    })
    const board = makeBoard({ waiting_parts_vendor: [waiting] })
    // Act
    const intent = restoreIntentForCard(board, waiting.id)
    // Assert — the waiting fields ride along (entry into the lane requires them)
    expect(intent).toMatchObject({
      toLane: 'waiting_parts_vendor',
      waitingReason: 'parts',
      expectedResumeAt: '2026-08-01',
    })
  })

  it('returns null for a card that is not on the board (off-board / terminal)', () => {
    // Arrange
    const board = makeBoard({ ready: [makeCard('ready')] })
    // Act
    const intent = restoreIntentForCard(board, 999999)
    // Assert
    expect(intent).toBeNull()
  })
})
