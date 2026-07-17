import { type CardEvent } from '@rivian-kanban/core'
import { describe, expect, it } from 'vitest'
import { fixtureAdmin, makeCard, makeStatusChangedEvent, uid } from '../test/fixtures.ts'
import { describeActor, describeEvent, type HistoryContext } from './history.ts'

const card = makeCard('review')
const context: HistoryContext = {
  userNames: new Map([[fixtureAdmin.id, fixtureAdmin.displayName]]),
  laneLabels: { review: 'Review', done: 'Fertig' },
}

describe('describeEvent', () => {
  it('renders status changes with current lane labels', () => {
    // Arrange
    const event = makeStatusChangedEvent(card, 1, 'review', 'done')
    // Act
    const line = describeEvent(event, context)
    // Assert
    expect(line).toBe('moved the card from Review to Fertig')
  })

  it('renders field changes with the field name', () => {
    // Arrange
    const event: CardEvent = {
      id: uid(41),
      cardId: card.id,
      actorId: fixtureAdmin.id,
      actorKind: 'user',
      createdAt: '2026-07-01T10:00:00.000Z',
      eventType: 'card.field_changed',
      payload: { field: 'priority', from: 'P2', to: 'P0' },
    }
    // Act
    const line = describeEvent(event, context)
    // Assert
    expect(line).toBe('changed priority')
  })

  it('renders attachment events with the filename', () => {
    // Arrange
    const event: CardEvent = {
      id: uid(42),
      cardId: card.id,
      actorId: fixtureAdmin.id,
      actorKind: 'user',
      createdAt: '2026-07-01T10:00:00.000Z',
      eventType: 'attachment.added',
      payload: { attachmentId: uid(43), filename: 'quote.pdf' },
    }
    // Act
    const line = describeEvent(event, context)
    // Assert
    expect(line).toBe('attached quote.pdf')
  })
})

describe('describeEvent covers every audit event type', () => {
  const base = {
    id: uid(44),
    cardId: card.id,
    actorId: fixtureAdmin.id,
    actorKind: 'user' as const,
    createdAt: '2026-07-01T10:00:00.000Z',
  }
  const cases: [CardEvent, string][] = [
    [
      { ...base, eventType: 'card.created', payload: { snapshot: { ...card } } },
      'created the card',
    ],
    [
      {
        ...base,
        eventType: 'card.reordered',
        payload: { lane: 'ready', prevCardId: null, nextCardId: null },
      },
      'reordered the card within Ready',
    ],
    [{ ...base, eventType: 'card.blocked', payload: {} }, 'blocked the card: —'],
    [{ ...base, eventType: 'card.unblocked', payload: {} }, 'unblocked the card'],
    [
      {
        ...base,
        eventType: 'card.cancelled',
        payload: { resolution: 'declined', fromLane: 'intake' },
      },
      'cancelled the card (Declined)',
    ],
    [
      { ...base, eventType: 'card.reopened', payload: { toLane: 'ready' } },
      'reopened the card into Ready',
    ],
    [{ ...base, eventType: 'card.archived', payload: {} }, 'archived the card'],
    [{ ...base, eventType: 'comment.added', payload: { commentId: uid(45) } }, 'commented'],
    [{ ...base, eventType: 'comment.edited', payload: { commentId: uid(45) } }, 'edited a comment'],
    [
      { ...base, eventType: 'comment.deleted', payload: { commentId: uid(45) } },
      'deleted a comment',
    ],
    [
      {
        ...base,
        eventType: 'attachment.removed',
        payload: { attachmentId: uid(46), filename: 'old.png' },
      },
      'removed attachment old.png',
    ],
    [
      { ...base, eventType: 'card.pii_deleted', payload: { scope: 'all' } },
      'redacted personal data',
    ],
  ]

  it.each(cases)('describes %#', (event, expected) => {
    // Arrange
    const input = event
    // Act
    const line = describeEvent(input, context)
    // Assert
    expect(line).toBe(expected)
  })

  it('falls back to seeded lane names when no live labels are known', () => {
    // Arrange
    const event = makeStatusChangedEvent(card, 9, 'intake', 'in_progress')
    // Act
    const line = describeEvent(event, { userNames: new Map() })
    // Assert
    expect(line).toBe('moved the card from Intake to In Progress')
  })
})

describe('describeActor', () => {
  it('names user actors from the directory', () => {
    // Arrange
    const event = makeStatusChangedEvent(card, 2, 'ready', 'in_progress')
    // Act
    const actor = describeActor(event, context)
    // Assert
    expect(actor).toBe(fixtureAdmin.displayName)
  })

  it('labels service actors by kind (AI agent, System)', () => {
    // Arrange
    const base = makeStatusChangedEvent(card, 3, 'ready', 'in_progress')
    const mcpEvent: CardEvent = { ...base, actorKind: 'mcp' }
    const systemEvent: CardEvent = { ...base, actorKind: 'system', actorId: null }
    // Act
    const mcpActor = describeActor(mcpEvent, context)
    const systemActor = describeActor(systemEvent, context)
    // Assert
    expect(mcpActor).toBe('AI agent')
    expect(systemActor).toBe('System')
  })

  it('falls back to "Slack" for slack actors without a directory entry', () => {
    // Arrange
    const base = makeStatusChangedEvent(card, 4, 'ready', 'in_progress')
    const slackEvent: CardEvent = { ...base, actorKind: 'slack', actorId: uid(47) }
    // Act
    const actor = describeActor(slackEvent, context)
    // Assert
    expect(actor).toBe('Slack')
  })
})
