import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import { ConflictError, IllegalTransitionError, PolicyDeniedError } from '../domain/errors.ts'
import { DEFAULT_POLICY_DOCUMENT } from '../domain/policy.ts'
import { createScenario } from '../testing/index.ts'

const ENFORCED = { ...DEFAULT_POLICY_DOCUMENT, transitionEnforcement: true }

describe('CardService.move — cross-lane', () => {
  it('moves between lanes and audits card.status_changed with lane keys', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard({ laneId: scenario.lanes.ready.id })

    // Act
    const moved = await scenario.cards.move(scenario.actors.technician, card.id, {
      toLane: 'in_progress',
      expectedVersion: 1,
    })

    // Assert
    expect(moved.laneId).toBe(scenario.lanes.in_progress.id)
    expect(moved.version).toBe(2)
    expect(scenario.db.eventsFor(card.id).at(0)).toMatchObject({
      eventType: 'card.status_changed',
      payload: { fromLane: 'ready', toLane: 'in_progress' },
    })
    expect(scenario.eventBus.published.at(0)).toMatchObject({
      type: 'card.status_changed',
      cardId: card.id,
      version: 2,
    })
  })

  it('stamps workStartedAt on the first In Progress entry, keeps it, and resets on reopen', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard({ laneId: scenario.lanes.ready.id })
    const tech = scenario.actors.technician

    // Act — first entry into In Progress records the work start
    const started = await scenario.cards.move(tech, card.id, {
      toLane: 'in_progress',
      expectedVersion: card.version,
    })
    // Assert
    expect(started.workStartedAt).not.toBeNull()
    const firstStart = started.workStartedAt

    // Act — bounce to review and back a day later; the start is set ONCE
    scenario.clock.advanceDays(1)
    const inReview = await scenario.cards.move(tech, card.id, {
      toLane: 'review',
      expectedVersion: started.version,
    })
    const backInProgress = await scenario.cards.move(tech, card.id, {
      toLane: 'in_progress',
      expectedVersion: inReview.version,
    })
    // Assert — unchanged despite the clock moving on
    expect(backInProgress.workStartedAt).toBe(firstStart)

    // Act — finish, then reopen for a fresh cycle
    const done = await scenario.cards.move(tech, card.id, {
      toLane: 'done',
      expectedVersion: backInProgress.version,
    })
    const reopened = await scenario.cards.reopen(tech, card.id, { expectedVersion: done.version })
    // Assert — reopen clears the anchor so the next In Progress restarts it
    expect(reopened.workStartedAt).toBeNull()
  })

  it('positions the card between the re-read neighbors', async () => {
    // Arrange
    const scenario = createScenario()
    const first = scenario.seedCard({ laneId: scenario.lanes.ready.id })
    const second = scenario.seedCard({ laneId: scenario.lanes.ready.id })
    const card = scenario.seedCard({ laneId: scenario.lanes.intake.id })

    // Act
    const moved = await scenario.cards.move(scenario.actors.technician, card.id, {
      toLane: 'ready',
      prevCardId: first.id,
      nextCardId: second.id,
      expectedVersion: 1,
    })

    // Assert
    expect(moved.position > first.position).toBe(true)
    expect(moved.position < second.position).toBe(true)
  })

  it('flags wipLimitExceeded when the move pushes the destination over its limit', async () => {
    // Arrange
    const scenario = createScenario({ wipLimits: { in_progress: 1 } })
    const occupant = scenario.seedCard({ laneId: scenario.lanes.in_progress.id })
    const card = scenario.seedCard({ laneId: scenario.lanes.ready.id })

    // Act
    await scenario.cards.move(scenario.actors.technician, card.id, {
      toLane: 'in_progress',
      prevCardId: occupant.id,
      expectedVersion: 1,
    })

    // Assert
    expect(scenario.db.eventsFor(card.id).at(0)?.payload).toEqual({
      fromLane: 'ready',
      toLane: 'in_progress',
      wipLimitExceeded: true,
    })
  })

  it('does not flag wipLimitExceeded when the destination stays at its limit', async () => {
    // Arrange
    const scenario = createScenario({ wipLimits: { in_progress: 1 } })
    const card = scenario.seedCard({ laneId: scenario.lanes.ready.id })

    // Act
    await scenario.cards.move(scenario.actors.technician, card.id, {
      toLane: 'in_progress',
      expectedVersion: 1,
    })

    // Assert
    expect(scenario.db.eventsFor(card.id).at(0)?.payload).toEqual({
      fromLane: 'ready',
      toLane: 'in_progress',
    })
  })
})

describe('CardService.move — waiting-lane discipline', () => {
  it('requires waitingReason and expectedResumeAt on entry (validation error)', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard({ laneId: scenario.lanes.in_progress.id })

    // Act
    const act = scenario.cards.move(scenario.actors.technician, card.id, {
      toLane: 'waiting_parts_vendor',
      expectedVersion: 1,
    })

    // Assert
    await expect(act).rejects.toBeInstanceOf(ZodError)
    expect(scenario.db.getCard(card.id).laneId).toBe(scenario.lanes.in_progress.id)
  })

  it('stores the waiting fields on entry', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard({ laneId: scenario.lanes.in_progress.id })

    // Act
    const moved = await scenario.cards.move(scenario.actors.technician, card.id, {
      toLane: 'waiting_parts_vendor',
      waitingReason: 'vendor',
      expectedResumeAt: '2026-08-01',
      expectedVersion: 1,
    })

    // Assert
    expect(moved.waitingReason).toBe('vendor')
    expect(moved.expectedResumeAt).toBe('2026-08-01')
    expect(moved.resumeAlertedAt).toBeNull()
  })

  it('clears the waiting fields on exit and records clearedWaiting in the event', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard({
      laneId: scenario.lanes.waiting_parts_vendor.id,
      waitingReason: 'parts',
      expectedResumeAt: '2026-07-20',
      resumeAlertedAt: '2026-07-10T00:00:00.000Z',
    })

    // Act
    const moved = await scenario.cards.move(scenario.actors.technician, card.id, {
      toLane: 'in_progress',
      expectedVersion: 1,
    })

    // Assert
    expect(moved.waitingReason).toBeNull()
    expect(moved.expectedResumeAt).toBeNull()
    expect(moved.resumeAlertedAt).toBeNull()
    expect(scenario.db.eventsFor(card.id).at(0)?.payload).toEqual({
      fromLane: 'waiting_parts_vendor',
      toLane: 'in_progress',
      clearedWaiting: true,
    })
  })

  it('does not require waiting fields for a reorder within the waiting lane', async () => {
    // Arrange
    const scenario = createScenario()
    const other = scenario.seedCard({
      laneId: scenario.lanes.waiting_parts_vendor.id,
      waitingReason: 'parts',
      expectedResumeAt: '2026-07-20',
    })
    const card = scenario.seedCard({
      laneId: scenario.lanes.waiting_parts_vendor.id,
      waitingReason: 'vendor',
      expectedResumeAt: '2026-07-25',
    })

    // Act
    const moved = await scenario.cards.move(scenario.actors.technician, card.id, {
      toLane: 'waiting_parts_vendor',
      nextCardId: other.id,
      expectedVersion: 1,
    })

    // Assert
    expect(moved.waitingReason).toBe('vendor')
    expect(moved.position < other.position).toBe(true)
  })
})

describe('CardService.move — terminal semantics via drag', () => {
  it('sets resolution completed and notifies the requester on entry into done', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard({ laneId: scenario.lanes.review.id })

    // Act
    const moved = await scenario.cards.move(scenario.actors.supervisor, card.id, {
      toLane: 'done',
      expectedVersion: 1,
    })

    // Assert
    expect(moved.resolution).toBe('completed')
    expect(scenario.notifier.completedCards.map((completed) => completed.id)).toEqual([card.id])
  })

  it('clears resolution when a done card is dragged back out (permissive)', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard({ laneId: scenario.lanes.done.id, resolution: 'completed' })

    // Act
    const moved = await scenario.cards.move(scenario.actors.technician, card.id, {
      toLane: 'ready',
      expectedVersion: 1,
    })

    // Assert
    expect(moved.resolution).toBeNull()
    expect(scenario.notifier.completedCards).toHaveLength(0)
  })

  it('applies the reopen action gate to drags out of done (enforcement off)', async () => {
    // Arrange
    const scenario = createScenario({
      policy: { ...DEFAULT_POLICY_DOCUMENT, actionGates: { reopen: 'admin' } },
    })
    const card = scenario.seedCard({ laneId: scenario.lanes.done.id, resolution: 'completed' })

    // Act
    const act = scenario.cards.move(scenario.actors.technician, card.id, {
      toLane: 'ready',
      expectedVersion: 1,
    })

    // Assert
    await expect(act).rejects.toBeInstanceOf(PolicyDeniedError)
    await expect(act).rejects.toMatchObject({ rule: 'actionGates.reopen' })
    expect(scenario.db.getCard(card.id)).toMatchObject({
      laneId: scenario.lanes.done.id,
      resolution: 'completed',
    })
  })

  it('lets a supervisor drag out of done through the reopen gate', async () => {
    // Arrange
    const scenario = createScenario({
      policy: { ...DEFAULT_POLICY_DOCUMENT, actionGates: { reopen: 'admin' } },
    })
    const card = scenario.seedCard({ laneId: scenario.lanes.done.id, resolution: 'completed' })

    // Act
    const moved = await scenario.cards.move(scenario.actors.supervisor, card.id, {
      toLane: 'in_progress',
      expectedVersion: 1,
    })

    // Assert
    expect(moved.laneId).toBe(scenario.lanes.in_progress.id)
    expect(moved.resolution).toBeNull()
  })

  it('does not consult the reopen gate for moves that do not leave done', async () => {
    // Arrange
    const scenario = createScenario({
      policy: { ...DEFAULT_POLICY_DOCUMENT, actionGates: { reopen: 'admin' } },
    })
    const card = scenario.seedCard({ laneId: scenario.lanes.ready.id })

    // Act
    const moved = await scenario.cards.move(scenario.actors.technician, card.id, {
      toLane: 'in_progress',
      expectedVersion: 1,
    })

    // Assert
    expect(moved.laneId).toBe(scenario.lanes.in_progress.id)
  })

  it('still resolves the committed move when the completion notification fails', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard({ laneId: scenario.lanes.review.id })
    scenario.notifier.failWith = new Error('slack outage')

    // Act
    const moved = await scenario.cards.move(scenario.actors.supervisor, card.id, {
      toLane: 'done',
      expectedVersion: 1,
    })

    // Assert
    expect(moved.resolution).toBe('completed')
    expect(scenario.db.getCard(card.id).laneId).toBe(scenario.lanes.done.id)
    expect(scenario.eventBus.published).toHaveLength(1)
  })
})

describe('CardService.move — reorders', () => {
  it('audits a reorder as card.reordered, never card.status_changed', async () => {
    // Arrange
    const scenario = createScenario()
    const first = scenario.seedCard({ laneId: scenario.lanes.ready.id })
    const card = scenario.seedCard({ laneId: scenario.lanes.ready.id })

    // Act
    const moved = await scenario.cards.move(scenario.actors.requester, card.id, {
      toLane: 'ready',
      nextCardId: first.id,
      expectedVersion: 1,
    })

    // Assert
    expect(moved.position < first.position).toBe(true)
    expect(moved.version).toBe(2)
    expect(scenario.db.eventsFor(card.id)).toHaveLength(1)
    expect(scenario.db.eventsFor(card.id).at(0)).toMatchObject({
      eventType: 'card.reordered',
      payload: { lane: 'ready', prevCardId: null, nextCardId: first.id },
    })
  })
})

describe('CardService.move — conflicts and ordering races', () => {
  it('rejects neighbors that are no longer in the target lane', async () => {
    // Arrange
    const scenario = createScenario()
    const stranger = scenario.seedCard({ laneId: scenario.lanes.review.id })
    const card = scenario.seedCard({ laneId: scenario.lanes.ready.id })

    // Act
    const act = scenario.cards.move(scenario.actors.technician, card.id, {
      toLane: 'in_progress',
      prevCardId: stranger.id,
      expectedVersion: 1,
    })

    // Assert
    await expect(act).rejects.toBeInstanceOf(ConflictError)
    expect(scenario.db.getCard(card.id).laneId).toBe(scenario.lanes.ready.id)
  })

  it('rejects a stale expectedVersion with the current card', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard({ laneId: scenario.lanes.ready.id, version: 5 })

    // Act
    const act = scenario.cards.move(scenario.actors.technician, card.id, {
      toLane: 'in_progress',
      expectedVersion: 4,
    })

    // Assert
    await expect(act).rejects.toBeInstanceOf(ConflictError)
    await expect(act).rejects.toMatchObject({ current: { version: 5 } })
  })

  it('retries once with re-read neighbors when the unique position backstop fires', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard({ laneId: scenario.lanes.ready.id })
    scenario.db.failNextCardPositionWrite = true

    // Act
    const moved = await scenario.cards.move(scenario.actors.technician, card.id, {
      toLane: 'in_progress',
      expectedVersion: 1,
    })

    // Assert
    expect(moved.laneId).toBe(scenario.lanes.in_progress.id)
    expect(scenario.db.eventsFor(card.id)).toHaveLength(1)
    expect(scenario.db.failNextCardPositionWrite).toBe(false)
  })

  it('surfaces a conflict carrying the current card when the duplicate persists after the single retry', async () => {
    // Arrange
    const scenario = createScenario()
    scenario.seedCard({ laneId: scenario.lanes.in_progress.id, position: 'a0' })
    const card = scenario.seedCard({ laneId: scenario.lanes.ready.id })

    // Act
    const act = scenario.cards.move(scenario.actors.technician, card.id, {
      toLane: 'in_progress',
      expectedVersion: 1,
    })

    // Assert
    await expect(act).rejects.toBeInstanceOf(ConflictError)
    await expect(act).rejects.toMatchObject({ current: { id: card.id, version: 1 } })
    expect(scenario.db.getCard(card.id).laneId).toBe(scenario.lanes.ready.id)
    expect(scenario.db.eventsFor(card.id)).toHaveLength(0)
    expect(scenario.eventBus.published).toHaveLength(0)
  })
})

describe('CardService.move — transition enforcement on', () => {
  it('rejects an off-graph move as an illegal transition (422)', async () => {
    // Arrange
    const scenario = createScenario({ policy: ENFORCED })
    const card = scenario.seedCard({ laneId: scenario.lanes.intake.id })

    // Act
    const act = scenario.cards.move(scenario.actors.admin, card.id, {
      toLane: 'ready',
      expectedVersion: 1,
    })

    // Assert
    await expect(act).rejects.toBeInstanceOf(IllegalTransitionError)
    await expect(act).rejects.toMatchObject({ from: 'intake', to: 'ready' })
  })

  it('applies the per-edge role gate to approval moves', async () => {
    // Arrange
    const scenario = createScenario({ policy: ENFORCED })
    const card = scenario.seedCard({ laneId: scenario.lanes.waiting_approval.id })

    // Act
    const act = scenario.cards.move(scenario.actors.technician, card.id, {
      toLane: 'ready',
      expectedVersion: 1,
    })

    // Assert
    await expect(act).rejects.toBeInstanceOf(PolicyDeniedError)
    await expect(act).rejects.toMatchObject({ rule: 'transition:waiting_approval->ready' })
  })

  it('allows a supervisor through the gated approval edge', async () => {
    // Arrange
    const scenario = createScenario({ policy: ENFORCED })
    const card = scenario.seedCard({ laneId: scenario.lanes.waiting_approval.id })

    // Act
    const moved = await scenario.cards.move(scenario.actors.supervisor, card.id, {
      toLane: 'ready',
      expectedVersion: 1,
    })

    // Assert
    expect(moved.laneId).toBe(scenario.lanes.ready.id)
  })
})

describe('CardService.claimOverdueWaitingAlerts', () => {
  it('claims overdue episodes once, resolving assignee + active admins deduped', async () => {
    // Arrange: fixed clock is 2026-07-16 — overdue starts the day AFTER the date
    const scenario = createScenario()
    const overdue = scenario.seedCard({
      laneId: scenario.lanes.waiting_parts_vendor.id,
      waitingReason: 'parts',
      expectedResumeAt: '2026-07-15',
      assigneeId: scenario.users.technician.id,
    })
    scenario.seedCard({
      laneId: scenario.lanes.waiting_parts_vendor.id,
      waitingReason: 'vendor',
      expectedResumeAt: '2026-07-16',
    })

    // Act
    const first = await scenario.cards.claimOverdueWaitingAlerts()
    const second = await scenario.cards.claimOverdueWaitingAlerts()

    // Assert — one claim per episode; assignee first, then every active admin
    // (both fixture admins), deduped; the system automation user is excluded.
    expect(first.map((alert) => alert.card.id)).toEqual([overdue.id])
    expect(first.at(0)?.card.resumeAlertedAt).toBe('2026-07-16T12:00:00.000Z')
    expect(first.at(0)?.recipients.map((user) => user.id)).toEqual([
      scenario.users.technician.id,
      scenario.users.supervisor.id,
      scenario.users.admin.id,
    ])
    expect(second).toEqual([])
  })
})
