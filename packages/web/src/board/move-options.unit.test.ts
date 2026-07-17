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

describe('positionChoices', () => {
  it('offers First and After-each-card with correct neighbor ids', () => {
    // Arrange
    const a = makeCard('ready', { title: 'Fix pump' })
    const b = makeCard('ready', { title: 'Change filter' })
    const moving = makeCard('intake')
    // Act
    const choices = positionChoices([a, b], moving.id, {
      first: 'First',
      after: (title) => `After "${title}"`,
    })
    // Assert
    expect(choices.map((choice) => choice.label)).toEqual([
      'First',
      'After "Fix pump"',
      'After "Change filter"',
    ])
    expect(choices[0]).toMatchObject({ prevCardId: null, nextCardId: a.id })
    expect(choices[1]).toMatchObject({ prevCardId: a.id, nextCardId: b.id })
    expect(choices[2]).toMatchObject({ prevCardId: b.id, nextCardId: null })
  })

  it('excludes the moving card from its own lane choices', () => {
    // Arrange
    const moving = makeCard('ready')
    const other = makeCard('ready')
    // Act
    const choices = positionChoices([moving, other], moving.id, {
      first: 'First',
      after: (title) => title,
    })
    // Assert
    expect(choices).toHaveLength(2)
    expect(choices[0]).toMatchObject({ prevCardId: null, nextCardId: other.id })
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
