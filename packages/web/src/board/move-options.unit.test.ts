import { describe, expect, it } from 'vitest'
import { enforcedPolicy, makeBoard, makeCard, permissivePolicy } from '../test/fixtures.ts'
import {
  canMoveToLane,
  canPerformAction,
  dropPosition,
  isSamePosition,
  moveIntentFromDrop,
  positionChoices,
} from './move-options.ts'

describe('canMoveToLane', () => {
  it('allows any lane in the default permissive posture (ADR-013)', () => {
    // Arrange
    const policy = permissivePolicy
    // Act
    const allowed = canMoveToLane(policy, 'requester', 'done', 'intake')
    // Assert
    expect(allowed).toBe(true)
  })

  it('allows only seeded graph edges when enforcement is on', () => {
    // Arrange
    const policy = enforcedPolicy
    // Act
    const legal = canMoveToLane(policy, 'technician', 'intake', 'waiting_approval')
    const illegal = canMoveToLane(policy, 'technician', 'intake', 'ready')
    // Assert
    expect(legal).toBe(true)
    expect(illegal).toBe(false)
  })

  it('applies per-transition role gates when enforcement is on', () => {
    // Arrange — waiting_approval → ready is supervisor-gated in the seed
    const policy = enforcedPolicy
    // Act
    const asTechnician = canMoveToLane(policy, 'technician', 'waiting_approval', 'ready')
    const asSupervisor = canMoveToLane(policy, 'supervisor', 'waiting_approval', 'ready')
    // Assert
    expect(asTechnician).toBe(false)
    expect(asSupervisor).toBe(true)
  })

  it('gates within-Ready reorders behind reorderReady regardless of enforcement', () => {
    // Arrange
    const gated = { ...permissivePolicy, actionGates: { reorderReady: 'supervisor' as const } }
    // Act
    const asTechnician = canMoveToLane(gated, 'technician', 'ready', 'ready')
    const asSupervisor = canMoveToLane(gated, 'supervisor', 'ready', 'ready')
    const otherLane = canMoveToLane(gated, 'technician', 'intake', 'intake')
    // Assert
    expect(asTechnician).toBe(false)
    expect(asSupervisor).toBe(true)
    expect(otherLane).toBe(true)
  })

  it('treats a drag out of done as reopen: the reopen gate applies (server parity)', () => {
    // Arrange — CardService.move consults card.reopen for moves out of done
    const gated = { ...permissivePolicy, actionGates: { reopen: 'supervisor' as const } }
    // Act
    const asTechnician = canMoveToLane(gated, 'technician', 'done', 'ready')
    const asSupervisor = canMoveToLane(gated, 'supervisor', 'done', 'ready')
    // Assert
    expect(asTechnician).toBe(false)
    expect(asSupervisor).toBe(true)
  })
})

describe('canPerformAction', () => {
  it('is permissive when the gate is absent and role-gated when present', () => {
    // Arrange
    const gated = { ...permissivePolicy, actionGates: { cancel: 'supervisor' as const } }
    // Act
    const ungated = canPerformAction(permissivePolicy, 'requester', 'cancel')
    const denied = canPerformAction(gated, 'technician', 'cancel')
    const allowed = canPerformAction(gated, 'admin', 'cancel')
    // Assert
    expect(ungated).toBe(true)
    expect(denied).toBe(false)
    expect(allowed).toBe(true)
  })

  it('applies the done→ready transition to the reopen affordance when enforcement is on', () => {
    // Arrange — core's engine ties reopen to the done→ready edge (supervisor
    // in the seeded graph); the UI must not offer a Reopen the server rejects.
    const policy = enforcedPolicy
    // Act
    const asTechnician = canPerformAction(policy, 'technician', 'reopen')
    const asSupervisor = canPerformAction(policy, 'supervisor', 'reopen')
    const enforcementOff = canPerformAction(permissivePolicy, 'technician', 'reopen')
    // Assert
    expect(asTechnician).toBe(false)
    expect(asSupervisor).toBe(true)
    expect(enforcementOff).toBe(true)
  })

  it('evaluates the delete-others gates for comments and attachments (ADR-013)', () => {
    // Arrange
    const gated = {
      ...permissivePolicy,
      actionGates: {
        deleteOthersComments: 'supervisor' as const,
        deleteOthersAttachments: 'admin' as const,
      },
    }
    // Act
    const commentsUngated = canPerformAction(permissivePolicy, 'requester', 'deleteOthersComments')
    const commentsDenied = canPerformAction(gated, 'technician', 'deleteOthersComments')
    const commentsAllowed = canPerformAction(gated, 'supervisor', 'deleteOthersComments')
    const attachmentsDenied = canPerformAction(gated, 'supervisor', 'deleteOthersAttachments')
    // Assert
    expect(commentsUngated).toBe(true)
    expect(commentsDenied).toBe(false)
    expect(commentsAllowed).toBe(true)
    expect(attachmentsDenied).toBe(false)
  })
})

const LABELS = {
  first: 'First',
  last: 'Last',
  after: (title: string) => `After "${title}"`,
}

describe('positionChoices', () => {
  it('offers First, per-card After for the middle, and a named Last (ITEM 2)', () => {
    // Arrange — three other cards, so there are true middle placements.
    const a = makeCard('ready', { title: 'Fix pump' })
    const b = makeCard('ready', { title: 'Change filter' })
    const c = makeCard('ready', { title: 'Grease bearings' })
    const moving = makeCard('intake')
    // Act
    const choices = positionChoices([a, b, c], moving.id, LABELS)
    // Assert — First, After-each-but-the-last (middle), then a clear Last. The
    // redundant "After <last card>" is replaced by the named Last option.
    expect(choices.map((choice) => choice.label)).toEqual([
      'First',
      'After "Fix pump"',
      'After "Change filter"',
      'Last',
    ])
    expect(choices[0]).toMatchObject({ prevCardId: null, nextCardId: a.id })
    expect(choices[1]).toMatchObject({ prevCardId: a.id, nextCardId: b.id })
    expect(choices[2]).toMatchObject({ prevCardId: b.id, nextCardId: c.id })
    expect(choices[3]).toMatchObject({ prevCardId: c.id, nextCardId: null })
  })

  it('offers exactly First and Last for a single-other-card lane (no middle)', () => {
    // Arrange
    const only = makeCard('ready', { title: 'Sole card' })
    const moving = makeCard('intake')
    // Act
    const choices = positionChoices([only], moving.id, LABELS)
    // Assert — top or bottom relative to the one card; no per-card After.
    expect(choices.map((choice) => choice.label)).toEqual(['First', 'Last'])
    expect(choices[0]).toMatchObject({ prevCardId: null, nextCardId: only.id })
    expect(choices[1]).toMatchObject({ prevCardId: only.id, nextCardId: null })
  })

  it('always offers both First and Last for an empty target lane', () => {
    // Arrange
    const moving = makeCard('intake')
    // Act
    const choices = positionChoices([], moving.id, LABELS)
    // Assert — both shown (same landing spot) so the picker keeps its shape.
    expect(choices.map((choice) => choice.label)).toEqual(['First', 'Last'])
    expect(choices[0]).toMatchObject({ prevCardId: null, nextCardId: null })
    expect(choices[1]).toMatchObject({ prevCardId: null, nextCardId: null })
  })

  it('excludes the moving card so its own (otherwise empty) lane still shows First and Last', () => {
    // Arrange — the moving card is the only card in the lane.
    const moving = makeCard('ready')
    // Act
    const choices = positionChoices([moving], moving.id, LABELS)
    // Assert
    expect(choices.map((choice) => choice.label)).toEqual(['First', 'Last'])
    expect(choices[0]).toMatchObject({ prevCardId: null, nextCardId: null })
  })
})

describe('moveIntentFromDrop', () => {
  it('computes neighbors from a drop on a card top edge', () => {
    // Arrange
    const a = makeCard('ready')
    const b = makeCard('ready')
    const moving = makeCard('intake')
    const board = makeBoard({ intake: [moving], ready: [a, b] })
    // Act
    const intent = moveIntentFromDrop(board, moving.id, {
      laneKey: 'ready',
      overCardId: b.id,
      edge: 'top',
    })
    // Assert
    expect(intent).toEqual({ toLane: 'ready', prevCardId: a.id, nextCardId: b.id })
  })

  it('appends to the lane end when dropped on empty lane space', () => {
    // Arrange
    const a = makeCard('ready')
    const moving = makeCard('intake')
    const board = makeBoard({ intake: [moving], ready: [a] })
    // Act
    const intent = moveIntentFromDrop(board, moving.id, { laneKey: 'ready' })
    // Assert
    expect(intent).toEqual({ toLane: 'ready', prevCardId: a.id, nextCardId: null })
  })

  it('returns null for a no-op drop at the current position', () => {
    // Arrange
    const a = makeCard('ready')
    const b = makeCard('ready')
    const board = makeBoard({ ready: [a, b] })
    // Act
    const intent = moveIntentFromDrop(board, b.id, {
      laneKey: 'ready',
      overCardId: a.id,
      edge: 'bottom',
    })
    // Assert
    expect(intent).toBeNull()
  })

  it('treats a drop on the card itself as a no-op, not a move to the lane end', () => {
    // Arrange — a mid-lane card dropped back onto its own footprint
    const a = makeCard('ready')
    const moving = makeCard('ready')
    const b = makeCard('ready')
    const board = makeBoard({ ready: [a, moving, b] })
    // Act
    const intent = moveIntentFromDrop(board, moving.id, {
      laneKey: 'ready',
      overCardId: moving.id,
      edge: 'bottom',
    })
    // Assert
    expect(intent).toBeNull()
  })
})

describe('isSamePosition', () => {
  it('detects the current neighbors and rejects any other placement', () => {
    // Arrange
    const a = makeCard('ready')
    const moving = makeCard('ready')
    const b = makeCard('ready')
    const board = makeBoard({ ready: [a, moving, b] })
    // Act
    const same = isSamePosition(board, moving.id, {
      toLane: 'ready',
      prevCardId: a.id,
      nextCardId: b.id,
    })
    const different = isSamePosition(board, moving.id, {
      toLane: 'ready',
      prevCardId: null,
      nextCardId: a.id,
    })
    const otherLane = isSamePosition(board, moving.id, {
      toLane: 'intake',
      prevCardId: null,
      nextCardId: null,
    })
    // Assert
    expect(same).toBe(true)
    expect(different).toBe(false)
    expect(otherLane).toBe(false)
  })
})

describe('dropPosition', () => {
  it('derives the lane label and 1-based landing position for announcements', () => {
    // Arrange
    const a = makeCard('ready')
    const b = makeCard('ready')
    const moving = makeCard('intake')
    const board = makeBoard({ intake: [moving], ready: [a, b] })
    // Act
    const first = dropPosition(board, moving.id, {
      toLane: 'ready',
      prevCardId: null,
      nextCardId: a.id,
    })
    const afterA = dropPosition(board, moving.id, {
      toLane: 'ready',
      prevCardId: a.id,
      nextCardId: b.id,
    })
    // Assert
    expect(first).toEqual({ laneLabel: 'Ready', position: 1 })
    expect(afterA).toEqual({ laneLabel: 'Ready', position: 2 })
  })
})
