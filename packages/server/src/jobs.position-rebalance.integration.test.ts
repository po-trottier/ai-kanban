import { pino } from 'pino'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Card, type Lane } from '@rivian-kanban/core'
import { runPositionRebalance } from './jobs/position-rebalance.ts'
import { createTestApp, rawCard, type TestApp } from './test/support.ts'

/**
 * The daily fractional-key rebalance against a real temp SQLite database
 * (ADR-006): lanes whose longest active key exceeds 100 chars get short fresh
 * keys in one transaction — order preserved, no audit events, no version
 * bumps — and the UNIQUE(laneId, position) backstop never fires mid-rewrite.
 * Archived rows are never rewritten (the done-lane archive is unbounded), so
 * the write transaction stays proportional to the live lane.
 */

let t: TestApp
let reporterId: string
const silentLog = pino({ level: 'silent' })

beforeEach(async () => {
  t = await createTestApp()
  reporterId = (await t.createUser('technician')).user.id
})

afterEach(async () => {
  await t.cleanup()
})

async function lane(key: 'ready' | 'in_progress'): Promise<Lane> {
  const found = await t.wired.deps.uow.run((tx) => tx.lanes.findByKey(t.wired.boardId, key))
  if (found === null) throw new Error(`lane ${key} missing`)
  return found
}

async function insertCard(laneId: string, position: string): Promise<Card> {
  const card = rawCard({
    boardId: t.wired.boardId,
    laneId,
    reporterId,
    position,
    title: `card at ${position.slice(0, 12)}`,
  })
  await t.wired.deps.uow.run((tx) => tx.cards.insert(card))
  return card
}

async function laneCards(laneId: string): Promise<Card[]> {
  return t.wired.deps.uow.run((tx) => tx.cards.listByLane(laneId))
}

async function runJob(): Promise<{ rebalancedLanes: number }> {
  return runPositionRebalance({
    uow: t.wired.deps.uow,
    logger: silentLog,
    boardId: t.wired.boardId,
  })
}

describe('position rebalance job', () => {
  it('shortens every key in a lane whose longest key exceeds 100 chars, preserving order', async () => {
    const ready = await lane('ready')
    const grown = `a0${'V'.repeat(120)}`
    const first = await insertCard(ready.id, 'a0')
    const second = await insertCard(ready.id, grown)
    const third = await insertCard(ready.id, 'a1')

    const summary = await runJob()

    expect(summary.rebalancedLanes).toBe(1)
    const after = await laneCards(ready.id)
    expect(after.map((card) => card.id)).toEqual([first.id, second.id, third.id])
    for (const card of after) {
      expect(card.position.length).toBeLessThanOrEqual(10)
      // Not a user-visible reorder (ADR-006): no version bump, no timestamp churn.
      expect(card.version).toBe(1)
    }
    const events = await t.wired.deps.uow.run((tx) => tx.events.listByCard(second.id))
    expect(events).toHaveLength(0)
  })

  it('never collides with keys other cards still hold: fresh keys sort above the lane maximum', async () => {
    // Ascending order 'A0' < 'a0' < 'a1VVV…'; a rewrite anchored at null
    // would try to set the first card to 'a0' while the second still holds
    // it, tripping UNIQUE(laneId, position) — fresh keys start past the max.
    const ready = await lane('ready')
    await insertCard(ready.id, 'A0')
    await insertCard(ready.id, 'a0')
    await insertCard(ready.id, `a1${'V'.repeat(120)}`)

    const summary = await runJob()

    expect(summary.rebalancedLanes).toBe(1)
    const positions = (await laneCards(ready.id)).map((card) => card.position)
    expect(positions).toEqual(['a2', 'a3', 'a4'])
  })

  it('leaves archived rows untouched and ignores their keys for the trigger', async () => {
    // The done-lane archive is unbounded; rewriting it would hold the single
    // writer for O(archive) statements. Archived keys are not rewritten, do
    // not trigger the job, and fresh active keys never collide with them.
    const ready = await lane('ready')
    const archived = await t.wired.deps.uow.run(async (tx) => {
      const card = rawCard({
        boardId: t.wired.boardId,
        laneId: ready.id,
        reporterId,
        position: `a9${'V'.repeat(120)}`,
        title: 'archived, long key',
        archivedAt: '2026-01-01T00:00:00.000Z',
      })
      await tx.cards.insert(card)
      return card
    })
    const active = await insertCard(ready.id, 'a0')

    const untouched = await runJob()
    expect(untouched.rebalancedLanes).toBe(0)

    const grown = await insertCard(ready.id, `a1${'V'.repeat(120)}`)
    const summary = await runJob()

    expect(summary.rebalancedLanes).toBe(1)
    const after = await laneCards(ready.id)
    const byId = new Map(after.map((card) => [card.id, card.position]))
    expect(byId.get(archived.id)).toBe(archived.position)
    // Actives re-keyed short, order preserved, past the archived maximum.
    const activePosition = byId.get(active.id) ?? ''
    const grownPosition = byId.get(grown.id) ?? ''
    for (const position of [activePosition, grownPosition]) {
      expect(position.length).toBeGreaterThan(0)
      expect(position.length).toBeLessThanOrEqual(10)
      expect(position > archived.position).toBe(true)
    }
    expect(activePosition < grownPosition).toBe(true)
  })

  it('leaves lanes at or under the threshold untouched', async () => {
    const ready = await lane('ready')
    const inProgress = await lane('in_progress')
    const atLimit = await insertCard(ready.id, `a0${'V'.repeat(98)}`)
    const short = await insertCard(inProgress.id, 'a0')

    const summary = await runJob()

    expect(summary.rebalancedLanes).toBe(0)
    const readyAfter = await laneCards(ready.id)
    expect(readyAfter[0]?.position).toBe(atLimit.position)
    const inProgressAfter = await laneCards(inProgress.id)
    expect(inProgressAfter[0]?.position).toBe(short.position)
  })
})
