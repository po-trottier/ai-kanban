import { pino } from 'pino'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Card, type Lane } from '@rivian-kanban/core'
import { runPositionRebalance } from './jobs/position-rebalance.ts'
import { createTestApp, rawCard, type TestApp } from './test/support.ts'

/**
 * The daily fractional-key rebalance against a real temp SQLite database
 * (ADR-006): lanes whose longest key exceeds 100 chars get short fresh keys
 * in one transaction — order preserved, no audit events, no version bumps —
 * and the UNIQUE(laneId, position) backstop never fires mid-rewrite.
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

  it('survives fresh keys colliding with keys other cards still hold (two-pass rewrite)', async () => {
    // Ascending order 'A0' < 'a0' < 'a1VVV…'; a naive single pass would set
    // the first card to the fresh key 'a0' while the second still holds it,
    // tripping UNIQUE(laneId, position).
    const ready = await lane('ready')
    await insertCard(ready.id, 'A0')
    await insertCard(ready.id, 'a0')
    await insertCard(ready.id, `a1${'V'.repeat(120)}`)

    const summary = await runJob()

    expect(summary.rebalancedLanes).toBe(1)
    const positions = (await laneCards(ready.id)).map((card) => card.position)
    expect(positions).toEqual(['a0', 'a1', 'a2'])
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
