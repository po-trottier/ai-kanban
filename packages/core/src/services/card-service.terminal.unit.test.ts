import { describe, expect, it } from 'vitest'
import {
  ArchivedError,
  ConflictError,
  IllegalTransitionError,
  PolicyDeniedError,
} from '../domain/errors.ts'
import { DEFAULT_POLICY_DOCUMENT } from '../domain/policy.ts'
import { createScenario } from '../testing/index.ts'

describe('CardService.cancel', () => {
  it('moves the card to the bottom of done with the cancel resolution', async () => {
    // Arrange
    const scenario = createScenario()
    const existingDone = scenario.seedCard({
      laneId: scenario.lanes.done.id,
      resolution: 'completed',
    })
    const card = scenario.seedCard({ laneId: scenario.lanes.in_progress.id })

    // Act
    const cancelled = await scenario.cards.cancel(scenario.actors.technician, card.id, {
      resolution: 'declined',
      expectedVersion: 1,
    })

    // Assert
    expect(cancelled.laneId).toBe(scenario.lanes.done.id)
    expect(cancelled.resolution).toBe('declined')
    expect(cancelled.position > existingDone.position).toBe(true)
    expect(cancelled.version).toBe(2)
  })

  it('emits a single card.cancelled event and sends no notification', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard({ laneId: scenario.lanes.intake.id })

    // Act
    await scenario.cards.cancel(scenario.actors.requester, card.id, {
      resolution: 'duplicate',
      expectedVersion: 1,
    })

    // Assert
    const events = scenario.db.eventsFor(card.id)
    expect(events).toHaveLength(1)
    expect(events.at(0)).toMatchObject({
      eventType: 'card.cancelled',
      payload: { resolution: 'duplicate', fromLane: 'intake' },
    })
    expect(scenario.notifier.completedCards).toHaveLength(0)
  })

  it('clears waiting fields when cancelling out of the waiting lane', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard({
      laneId: scenario.lanes.waiting_parts_vendor.id,
      waitingReason: 'parts',
      expectedResumeAt: '2026-07-20',
    })

    // Act
    const cancelled = await scenario.cards.cancel(scenario.actors.technician, card.id, {
      resolution: 'cancelled',
      expectedVersion: 1,
    })

    // Assert
    expect(cancelled.waitingReason).toBeNull()
    expect(cancelled.expectedResumeAt).toBeNull()
  })

  it('rejects cancelling a card already in done', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard({ laneId: scenario.lanes.done.id, resolution: 'completed' })

    // Act
    const act = scenario.cards.cancel(scenario.actors.technician, card.id, {
      resolution: 'cancelled',
      expectedVersion: 1,
    })

    // Assert
    await expect(act).rejects.toBeInstanceOf(ConflictError)
  })

  it('applies the cancel action gate', async () => {
    // Arrange
    const scenario = createScenario({
      policy: { ...DEFAULT_POLICY_DOCUMENT, actionGates: { cancel: 'supervisor' } },
    })
    const card = scenario.seedCard()

    // Act
    const act = scenario.cards.cancel(scenario.actors.technician, card.id, {
      resolution: 'cancelled',
      expectedVersion: 1,
    })

    // Assert
    await expect(act).rejects.toBeInstanceOf(PolicyDeniedError)
    await expect(act).rejects.toMatchObject({ rule: 'actionGates.cancel' })
    expect(scenario.db.getCard(card.id).laneId).toBe(scenario.lanes.intake.id)
  })
})

describe('CardService.reopen', () => {
  it('clears resolution and archival and lands at the bottom of ready', async () => {
    // Arrange
    const scenario = createScenario()
    const existingReady = scenario.seedCard({ laneId: scenario.lanes.ready.id })
    const card = scenario.seedCard({
      laneId: scenario.lanes.done.id,
      resolution: 'cancelled',
      archivedAt: '2026-04-01T00:00:00.000Z',
    })

    // Act
    const reopened = await scenario.cards.reopen(scenario.actors.supervisor, card.id, {
      expectedVersion: 1,
    })

    // Assert
    expect(reopened.laneId).toBe(scenario.lanes.ready.id)
    expect(reopened.resolution).toBeNull()
    expect(reopened.archivedAt).toBeNull()
    expect(reopened.position > existingReady.position).toBe(true)
    expect(scenario.db.eventsFor(card.id).at(0)).toMatchObject({
      eventType: 'card.reopened',
      payload: { toLane: 'ready' },
    })
  })

  it('rejects reopening a card that is not in done as an illegal transition', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard({ laneId: scenario.lanes.review.id })

    // Act
    const act = scenario.cards.reopen(scenario.actors.supervisor, card.id, { expectedVersion: 1 })

    // Assert
    await expect(act).rejects.toBeInstanceOf(IllegalTransitionError)
    await expect(act).rejects.toMatchObject({ from: 'review', to: 'ready' })
  })

  it('applies the reopen action gate independently of the transition graph', async () => {
    // Arrange
    const scenario = createScenario({
      policy: { ...DEFAULT_POLICY_DOCUMENT, actionGates: { reopen: 'supervisor' } },
    })
    const card = scenario.seedCard({ laneId: scenario.lanes.done.id, resolution: 'completed' })

    // Act
    const denied = scenario.cards.reopen(scenario.actors.technician, card.id, {
      expectedVersion: 1,
    })

    // Assert
    await expect(denied).rejects.toBeInstanceOf(PolicyDeniedError)
    await expect(denied).rejects.toMatchObject({ rule: 'actionGates.reopen' })
    expect(scenario.db.getCard(card.id).laneId).toBe(scenario.lanes.done.id)
  })

  it('lets a supervisor through the reopen action gate with enforcement off', async () => {
    // Arrange
    const scenario = createScenario({
      policy: { ...DEFAULT_POLICY_DOCUMENT, actionGates: { reopen: 'supervisor' } },
    })
    const card = scenario.seedCard({ laneId: scenario.lanes.done.id, resolution: 'cancelled' })

    // Act
    const reopened = await scenario.cards.reopen(scenario.actors.supervisor, card.id, {
      expectedVersion: 1,
    })

    // Assert
    expect(reopened.laneId).toBe(scenario.lanes.ready.id)
    expect(reopened.resolution).toBeNull()
  })

  it('applies the done→ready edge gate when enforcement is on', async () => {
    // Arrange
    const scenario = createScenario({
      policy: { ...DEFAULT_POLICY_DOCUMENT, transitionEnforcement: true },
    })
    const card = scenario.seedCard({ laneId: scenario.lanes.done.id, resolution: 'completed' })

    // Act
    const denied = scenario.cards.reopen(scenario.actors.technician, card.id, {
      expectedVersion: 1,
    })

    // Assert
    await expect(denied).rejects.toBeInstanceOf(PolicyDeniedError)
    await expect(denied).rejects.toMatchObject({ rule: 'transition:done->ready' })
  })
})

describe('CardService.archive', () => {
  it('archives a completed done card, sets archivedAt, and emits card.archived', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard({ laneId: scenario.lanes.done.id, resolution: 'completed' })

    // Act
    const archived = await scenario.cards.archive(scenario.actors.supervisor, card.id, {
      expectedVersion: 1,
    })

    // Assert
    expect(archived.archivedAt).toBe('2026-07-16T12:00:00.000Z')
    expect(archived.laneId).toBe(scenario.lanes.done.id)
    expect(archived.version).toBe(2)
    const events = scenario.db.eventsFor(card.id)
    expect(events).toHaveLength(1)
    expect(events.at(0)).toMatchObject({
      eventType: 'card.archived',
      actorKind: 'user',
      payload: {},
    })
  })

  it('archives a cancelled done card too', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard({ laneId: scenario.lanes.done.id, resolution: 'cancelled' })

    // Act
    const archived = await scenario.cards.archive(scenario.actors.technician, card.id, {
      expectedVersion: 1,
    })

    // Assert
    expect(archived.archivedAt).not.toBeNull()
  })

  it('rejects archiving a card that is not in the done lane', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard({ laneId: scenario.lanes.in_progress.id })

    // Act
    const act = scenario.cards.archive(scenario.actors.supervisor, card.id, { expectedVersion: 1 })

    // Assert
    await expect(act).rejects.toBeInstanceOf(ConflictError)
    expect(scenario.db.getCard(card.id).archivedAt).toBeNull()
    expect(scenario.db.eventsFor(card.id)).toHaveLength(0)
  })

  it('rejects archiving an already-archived card', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard({
      laneId: scenario.lanes.done.id,
      resolution: 'completed',
      archivedAt: '2026-04-01T00:00:00.000Z',
    })

    // Act
    const act = scenario.cards.archive(scenario.actors.supervisor, card.id, { expectedVersion: 1 })

    // Assert
    await expect(act).rejects.toBeInstanceOf(ArchivedError)
    expect(scenario.db.eventsFor(card.id)).toHaveLength(0)
  })

  it('409s a stale expectedVersion and commits nothing', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard({
      laneId: scenario.lanes.done.id,
      resolution: 'completed',
      version: 4,
    })

    // Act
    const act = scenario.cards.archive(scenario.actors.supervisor, card.id, { expectedVersion: 2 })

    // Assert
    await expect(act).rejects.toBeInstanceOf(ConflictError)
    expect(scenario.db.getCard(card.id).archivedAt).toBeNull()
  })

  it('applies the archive action gate when configured', async () => {
    // Arrange
    const scenario = createScenario({
      policy: { ...DEFAULT_POLICY_DOCUMENT, actionGates: { archive: 'supervisor' } },
    })
    const card = scenario.seedCard({ laneId: scenario.lanes.done.id, resolution: 'completed' })

    // Act
    const denied = scenario.cards.archive(scenario.actors.technician, card.id, {
      expectedVersion: 1,
    })

    // Assert
    await expect(denied).rejects.toBeInstanceOf(PolicyDeniedError)
    await expect(denied).rejects.toMatchObject({ rule: 'actionGates.archive' })
    expect(scenario.db.getCard(card.id).archivedAt).toBeNull()
  })

  it('publishes a card hint after archiving', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard({ laneId: scenario.lanes.done.id, resolution: 'completed' })

    // Act
    await scenario.cards.archive(scenario.actors.supervisor, card.id, { expectedVersion: 1 })

    // Assert
    expect(scenario.eventBus.published.at(-1)).toMatchObject({
      type: 'card.archived',
      cardId: card.id,
    })
  })
})

describe('CardService.block / unblock', () => {
  it('raises the blocked flag with reason and timestamp, in place', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard({ laneId: scenario.lanes.in_progress.id })

    // Act
    const blocked = await scenario.cards.block(scenario.actors.technician, card.id, {
      reason: 'Vendor unreachable',
      expectedVersion: 1,
    })

    // Assert
    expect(blocked.blocked).toBe(true)
    expect(blocked.blockedReason).toBe('Vendor unreachable')
    expect(blocked.blockedAt).toBe('2026-07-16T12:00:00.000Z')
    expect(blocked.laneId).toBe(scenario.lanes.in_progress.id)
    expect(scenario.db.eventsFor(card.id).at(0)).toMatchObject({
      eventType: 'card.blocked',
      payload: { reason: 'Vendor unreachable' },
    })
  })

  it('rejects blocking an already-blocked card', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard({
      blocked: true,
      blockedReason: 'Waiting on keys',
      blockedAt: '2026-07-10T00:00:00.000Z',
    })

    // Act
    const act = scenario.cards.block(scenario.actors.technician, card.id, {
      reason: 'Again',
      expectedVersion: 1,
    })

    // Assert
    await expect(act).rejects.toBeInstanceOf(ConflictError)
  })

  it('clears the flag on unblock and audits card.unblocked', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard({
      blocked: true,
      blockedReason: 'Parts missing',
      blockedAt: '2026-07-10T00:00:00.000Z',
    })

    // Act
    const unblocked = await scenario.cards.unblock(scenario.actors.technician, card.id, {
      expectedVersion: 1,
    })

    // Assert
    expect(unblocked.blocked).toBe(false)
    expect(unblocked.blockedReason).toBeNull()
    expect(unblocked.blockedAt).toBeNull()
    expect(scenario.db.eventsFor(card.id).at(0)?.eventType).toBe('card.unblocked')
  })

  it('rejects unblocking a card that is not blocked', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard()

    // Act
    const act = scenario.cards.unblock(scenario.actors.technician, card.id, { expectedVersion: 1 })

    // Assert
    await expect(act).rejects.toBeInstanceOf(ConflictError)
  })

  it('treats archived cards as read-only for blocking', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard({
      laneId: scenario.lanes.done.id,
      resolution: 'completed',
      archivedAt: '2026-04-01T00:00:00.000Z',
    })

    // Act
    const act = scenario.cards.block(scenario.actors.admin, card.id, {
      reason: 'Nope',
      expectedVersion: 1,
    })

    // Assert
    await expect(act).rejects.toBeInstanceOf(ArchivedError)
  })
})
