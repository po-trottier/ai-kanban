import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CardService,
  Uuidv7IdGenerator,
  type Actor,
  type Card,
  type SseHint,
  type User,
} from '@rivian-kanban/core'
import { FixedClock } from '@rivian-kanban/core/testing'
import { createTestApp, rawCard, type TestApp } from './test/support.ts'

/**
 * The daily done-archival behavior (`CardService.archiveExpired`, scheduled
 * by wiring/jobs.ts) against a real temp SQLite database
 * (docs/product/workflow.md#archival): cards archive 90 days after entering
 * Done (the newest entered-done audit event), `card.archived` is appended as
 * the system actor, an SSE hint is published per archived card (connected
 * boards drop them live), and reruns are no-ops. Invoked directly with a
 * FixedClock (docs/dev/testing.md — no fake timers).
 */

let t: TestApp

beforeEach(async () => {
  t = await createTestApp()
})

afterEach(async () => {
  await t.cleanup()
})

function actorOf(user: User): Actor {
  return { kind: 'user', id: user.id, role: user.role }
}

const systemActor = (): Actor => ({ kind: 'system', id: t.wired.systemUserId, role: 'admin' })

/** The real CardService over the real database, with the job-injected clock. */
async function runJob(clock: FixedClock): Promise<{ archived: number }> {
  const service = new CardService({
    uow: t.wired.deps.uow,
    clock,
    ids: new Uuidv7IdGenerator(),
    eventBus: t.wired.deps.eventBus,
    notifier: t.wired.notifier,
    boardId: t.wired.boardId,
    systemUserId: t.wired.systemUserId,
  })
  return service.archiveExpired(systemActor())
}

async function reloadCard(id: string): Promise<Card> {
  const card = await t.wired.deps.uow.read((tx) => tx.cards.findById(id))
  if (card === null) throw new Error(`card ${id} disappeared`)
  return card
}

/** A FixedClock `days` days after this real-time test run. */
function daysFromNow(days: number): FixedClock {
  return new FixedClock(new Date(Date.now() + days * 86_400_000).toISOString())
}

describe('done archival (CardService.archiveExpired)', () => {
  it('archives completed and cancelled cards 90 days after they entered done', async () => {
    const supervisor = await t.createUser('supervisor')
    const { cards } = t.wired.deps.services
    const completed = await cards.create(actorOf(supervisor.user), { title: 'completed work' })
    await cards.move(actorOf(supervisor.user), completed.id, {
      toLane: 'done',
      expectedVersion: completed.version,
    })
    const cancelled = await cards.create(actorOf(supervisor.user), { title: 'withdrawn work' })
    await cards.cancel(actorOf(supervisor.user), cancelled.id, {
      resolution: 'declined',
      expectedVersion: cancelled.version,
    })

    const tooSoon = await runJob(daysFromNow(89))
    const hints: SseHint[] = []
    const unsubscribe = t.wired.deps.eventBus.subscribe((hint) => hints.push(hint))
    const summary = await runJob(daysFromNow(91))
    unsubscribe()

    expect(tooSoon.archived).toBe(0)
    expect(summary.archived).toBe(2)
    const archived = await reloadCard(completed.id)
    expect(archived.archivedAt).not.toBeNull()
    expect((await reloadCard(cancelled.id)).archivedAt).not.toBeNull()
    // The audit event is appended in the same transaction, as the system actor.
    const events = await t.wired.deps.uow.read((tx) =>
      tx.events.listByCard(completed.id, { types: ['card.archived'] }),
    )
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ actorKind: 'system', actorId: null })
    // Connected boards learn about the archival live (ADR-008).
    expect(hints.map((hint) => hint.type)).toEqual(['card.archived', 'card.archived'])
  })

  it('reruns are no-ops: archived cards are never re-archived', async () => {
    const supervisor = await t.createUser('supervisor')
    const { cards } = t.wired.deps.services
    const card = await cards.create(actorOf(supervisor.user), { title: 'done long ago' })
    await cards.move(actorOf(supervisor.user), card.id, {
      toLane: 'done',
      expectedVersion: card.version,
    })

    await runJob(daysFromNow(91))
    const before = await reloadCard(card.id)
    const rerun = await runJob(daysFromNow(92))

    expect(rerun.archived).toBe(0)
    const after = await reloadCard(card.id)
    expect(after.archivedAt).toBe(before.archivedAt)
    expect(after.version).toBe(before.version)
    const events = await t.wired.deps.uow.read((tx) =>
      tx.events.listByCard(card.id, { types: ['card.archived'] }),
    )
    expect(events).toHaveLength(1)
  })

  it('leaves cards outside done untouched no matter their age', async () => {
    const supervisor = await t.createUser('supervisor')
    const { cards } = t.wired.deps.services
    const card = await cards.create(actorOf(supervisor.user), { title: 'still in intake' })

    const summary = await runJob(daysFromNow(365))

    expect(summary.archived).toBe(0)
    expect((await reloadCard(card.id)).archivedAt).toBeNull()
  })

  it('falls back to updatedAt for done cards without an entered-done event', async () => {
    // Directly seeded rows (fixtures, imports) may sit in done with no audit
    // trail; the job must still archive them from persisted state alone.
    const supervisor = await t.createUser('supervisor')
    const done = await t.wired.deps.uow.read((tx) => tx.lanes.findByKey(t.wired.boardId, 'done'))
    if (done === null) throw new Error('done lane missing')
    const old = '2026-01-01T00:00:00.000Z'
    const card = rawCard({
      boardId: t.wired.boardId,
      laneId: done.id,
      reporterId: supervisor.user.id,
      title: 'imported legacy ticket',
      resolution: 'completed',
      createdAt: old,
      updatedAt: old,
    })
    await t.wired.deps.uow.run((tx) => tx.cards.insert(card))

    const summary = await runJob(new FixedClock('2026-07-16T12:00:00.000Z'))

    expect(summary.archived).toBe(1)
    expect((await reloadCard(card.id)).archivedAt).toBe('2026-07-16T12:00:00.000Z')
  })
})
