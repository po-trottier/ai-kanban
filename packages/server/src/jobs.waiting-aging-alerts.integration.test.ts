import { pino } from 'pino'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CardService,
  Uuidv7IdGenerator,
  type Actor,
  type Card,
  type User,
} from '@rivian-kanban/core'
import { CapturingNotifier, FixedClock } from '@rivian-kanban/core/testing'
import { runWaitingAgingAlerts } from './jobs/waiting-aging-alerts.ts'
import { createTestApp, type TestApp } from './test/support.ts'

/**
 * The hourly waiting-lane aging job against a real temp SQLite database
 * (docs/product/workflow.md#waiting-on-parts--vendor-discipline): one DM per
 * overdue episode to the assignee + all active admins, `resumeAlertedAt`
 * claimed in the same transaction (CardService.claimOverdueWaitingAlerts),
 * notifier failures never failing the loop. The job's run function is invoked
 * directly with a FixedClock-driven CardService — croner scheduling is
 * smoke-tested separately (docs/dev/testing.md).
 */

let t: TestApp
/** 2026-07-16T12:00:00Z — six days past the fixture resume date below. */
let clock: FixedClock
let notifier: CapturingNotifier
const silentLog = pino({ level: 'silent' })

beforeEach(async () => {
  t = await createTestApp()
  clock = new FixedClock('2026-07-16T12:00:00.000Z')
  notifier = new CapturingNotifier()
})

afterEach(async () => {
  await t.cleanup()
})

function actorOf(user: User): Actor {
  return { kind: 'user', id: user.id, role: user.role }
}

async function runJob(): Promise<{ alerted: number }> {
  // The claim rule runs in core with the test's FixedClock (time is a port);
  // everything else — db, event bus — is the wired app's real instance.
  const cards = new CardService({
    uow: t.wired.deps.uow,
    clock,
    ids: new Uuidv7IdGenerator(),
    eventBus: t.wired.deps.eventBus,
    notifier,
    boardId: t.wired.boardId,
    systemUserId: t.wired.systemUserId,
  })
  return runWaitingAgingAlerts({ cards, notifier, logger: silentLog })
}

/** Creates a card and moves it into waiting_parts_vendor with the given date. */
async function waitingCard(
  mover: User,
  expectedResumeAt: string,
  overrides: { assigneeId?: string } = {},
): Promise<Card> {
  const { cards } = t.wired.deps.services
  const created = await cards.create(actorOf(mover), {
    title: `waiting until ${expectedResumeAt}`,
    ...(overrides.assigneeId !== undefined ? { assigneeId: overrides.assigneeId } : {}),
  })
  // Append below the lane's current bottom card — omitting both neighbors
  // targets the top, which conflicts once a second card arrives.
  const bottom = await t.wired.deps.uow.run(async (tx) => {
    const lane = await tx.lanes.findByKey(t.wired.boardId, 'waiting_parts_vendor')
    if (lane === null) throw new Error('waiting lane missing')
    return (await tx.cards.listByLane(lane.id)).at(-1)
  })
  return cards.move(actorOf(mover), created.id, {
    toLane: 'waiting_parts_vendor',
    expectedVersion: created.version,
    waitingReason: 'parts',
    expectedResumeAt,
    ...(bottom !== undefined ? { prevCardId: bottom.id } : {}),
  })
}

async function reloadCard(id: string): Promise<Card> {
  const card = await t.wired.deps.uow.run((tx) => tx.cards.findById(id))
  if (card === null) throw new Error(`card ${id} disappeared`)
  return card
}

describe('waiting aging alerts job', () => {
  it('DMs the assignee plus every active admin and claims the episode', async () => {
    const supervisor = await t.createUser('admin')
    const inactiveSupervisor = await t.createUser('admin', { isActive: false })
    const technician = await t.createUser('user')
    const card = await waitingCard(supervisor.user, '2026-07-10', {
      assigneeId: technician.user.id,
    })

    const summary = await runJob()

    expect(summary.alerted).toBe(1)
    expect(notifier.overdueAlerts).toHaveLength(1)
    const alert = notifier.overdueAlerts[0]
    expect(alert?.card.id).toBe(card.id)
    // Assignee first, then active admins — deduped, inactive excluded.
    expect(alert?.recipients.map((user) => user.id)).toEqual([
      technician.user.id,
      supervisor.user.id,
    ])
    expect(alert?.recipients.map((user) => user.id)).not.toContain(inactiveSupervisor.user.id)
    // The episode is claimed: resumeAlertedAt carries the job clock's instant.
    expect((await reloadCard(card.id)).resumeAlertedAt).toBe('2026-07-16T12:00:00.000Z')
  })

  it('alerts exactly once per overdue episode across repeated runs', async () => {
    const supervisor = await t.createUser('admin')
    await waitingCard(supervisor.user, '2026-07-10')

    await runJob()
    const second = await runJob()
    clock.advanceDays(1)
    const third = await runJob()

    expect(second.alerted).toBe(0)
    expect(third.alerted).toBe(0)
    expect(notifier.overdueAlerts).toHaveLength(1)
  })

  it('re-entering the lane with fresh values starts a fresh episode', async () => {
    const supervisor = await t.createUser('admin')
    const card = await waitingCard(supervisor.user, '2026-07-10')
    await runJob()

    const { cards } = t.wired.deps.services
    const out = await cards.move(actorOf(supervisor.user), card.id, {
      toLane: 'in_progress',
      expectedVersion: (await reloadCard(card.id)).version,
    })
    // Lane exit cleared the episode marker (workflow.md: one alert per episode).
    expect((await reloadCard(card.id)).resumeAlertedAt).toBeNull()
    await cards.move(actorOf(supervisor.user), card.id, {
      toLane: 'waiting_parts_vendor',
      expectedVersion: out.version,
      waitingReason: 'vendor',
      expectedResumeAt: '2026-07-12',
    })

    const summary = await runJob()

    expect(summary.alerted).toBe(1)
    expect(notifier.overdueAlerts).toHaveLength(2)
  })

  it('does not alert on the expected day itself — overdue starts the following UTC day', async () => {
    const supervisor = await t.createUser('admin')
    const today = await waitingCard(supervisor.user, '2026-07-16')
    const future = await waitingCard(supervisor.user, '2026-08-01')

    const summary = await runJob()

    expect(summary.alerted).toBe(0)
    expect(notifier.overdueAlerts).toHaveLength(0)
    expect((await reloadCard(today.id)).resumeAlertedAt).toBeNull()
    expect((await reloadCard(future.id)).resumeAlertedAt).toBeNull()
  })

  it('alerts admins only when the card has no assignee', async () => {
    const supervisor = await t.createUser('admin')
    await waitingCard(supervisor.user, '2026-07-10')

    await runJob()

    const recipientIds = notifier.overdueAlerts[0]?.recipients.map((user) => user.id)
    expect(recipientIds).toEqual([supervisor.user.id])
  })

  it('keeps the episode claimed when the notifier fails — the job never throws', async () => {
    const supervisor = await t.createUser('admin')
    const card = await waitingCard(supervisor.user, '2026-07-10')
    notifier.failWith = new Error('slack outage')

    const summary = await runJob()

    // The claim committed before delivery was attempted: no retry storm, no
    // duplicate DM once Slack recovers (at-most-once per episode).
    expect(summary.alerted).toBe(1)
    expect((await reloadCard(card.id)).resumeAlertedAt).not.toBeNull()
    notifier.failWith = null
    const retry = await runJob()
    expect(retry.alerted).toBe(0)
    expect(notifier.overdueAlerts).toHaveLength(0)
  })
})
