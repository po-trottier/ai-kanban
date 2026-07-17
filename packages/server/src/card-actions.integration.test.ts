import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestApp, type TestApp } from './test/support.ts'

/**
 * Card lifecycle actions: move/reorder (fractional ordering + waiting-lane
 * data rules), cancel, reopen, block/unblock — each with its optimistic-lock
 * and audit-trail assertions (ADR-006, ADR-012, docs/product/workflow.md).
 */

let t: TestApp
let cookie: string

beforeAll(async () => {
  t = await createTestApp()
  ;({ cookie } = await t.asRole('technician'))
})

afterAll(async () => {
  await t.cleanup()
})

interface CardBody {
  id: string
  laneId: string
  position: string
  version: number
  blocked: boolean
  blockedReason: string | null
  resolution: string | null
  waitingReason: string | null
  expectedResumeAt: string | null
  [key: string]: unknown
}

async function createCard(title: string): Promise<CardBody> {
  const response = await t.request(cookie, {
    method: 'POST',
    url: '/api/v1/cards',
    payload: { title },
  })
  return response.json<CardBody>()
}

async function act(
  card: { id: string; version: number },
  action: string,
  payload?: Record<string, unknown>,
) {
  return t.request(cookie, {
    method: 'POST',
    url: `/api/v1/cards/${card.id}/${action}`,
    headers: { 'if-match': `"${String(card.version)}"` },
    ...(payload !== undefined ? { payload } : {}),
  })
}

async function lastEvent(cardId: string) {
  const response = await t.request(cookie, {
    method: 'GET',
    url: `/api/v1/cards/${cardId}/events`,
  })
  const items = response.json<{
    items: { eventType: string; payload: Record<string, unknown> }[]
  }>().items
  return items.at(-1)
}

describe('POST /cards/:id/move', () => {
  it('moves across lanes and audits card.status_changed', async () => {
    const card = await createCard('Mover')

    const response = await act(card, 'move', { toLane: 'ready' })

    expect(response.statusCode).toBe(200)
    expect(response.headers.etag).toBe('"2"')
    const event = await lastEvent(card.id)
    expect(event).toMatchObject({
      eventType: 'card.status_changed',
      payload: { fromLane: 'intake', toLane: 'ready' },
    })
  })

  it('reorders within a lane between neighbors and audits card.reordered', async () => {
    const a = await createCard('Reorder A')
    const b = await createCard('Reorder B')
    const c = await createCard('Reorder C')

    // Newest lands on top: order is C, B, A. Move A between C and B.
    const response = await act(a, 'move', {
      toLane: 'intake',
      prevCardId: c.id,
      nextCardId: b.id,
    })

    expect(response.statusCode).toBe(200)
    const moved = response.json<CardBody>()
    expect(moved.position > c.position).toBe(true)
    expect(moved.position < b.position).toBe(true)
    const event = await lastEvent(a.id)
    expect(event?.eventType).toBe('card.reordered')
  })

  it('requires waitingReason + expectedResumeAt on waiting-lane entry (400) and clears them on exit', async () => {
    const card = await createCard('Waiting')

    const missing = await act(card, 'move', { toLane: 'waiting_parts_vendor' })
    expect(missing.statusCode).toBe(400)

    const entered = await act(card, 'move', {
      toLane: 'waiting_parts_vendor',
      waitingReason: 'parts',
      expectedResumeAt: '2026-08-01',
    })
    expect(entered.statusCode).toBe(200)
    expect(entered.json<CardBody>()).toMatchObject({
      waitingReason: 'parts',
      expectedResumeAt: '2026-08-01',
    })

    const left = await act(entered.json<CardBody>(), 'move', { toLane: 'in_progress' })
    expect(left.json<CardBody>()).toMatchObject({ waitingReason: null, expectedResumeAt: null })
  })

  it('409s stale neighbors (neighbor left the lane) with the current card', async () => {
    const card = await createCard('Stale neighbors')
    const neighbor = await createCard('Neighbor')
    const gone = await act(neighbor, 'move', { toLane: 'waiting_approval' })
    expect(gone.statusCode).toBe(200)

    const response = await act(card, 'move', { toLane: 'intake', prevCardId: neighbor.id })

    expect(response.statusCode).toBe(409)
    expect(response.json<{ current: { id: string } }>().current.id).toBe(card.id)
  })

  it('409s a stale If-Match version', async () => {
    const card = await createCard('Stale version')
    const first = await act(card, 'move', { toLane: 'review' })
    expect(first.statusCode).toBe(200)

    const stale = await act(card, 'move', { toLane: 'in_progress' })

    expect(stale.statusCode).toBe(409)
  })
})

describe('POST /cards/:id/cancel', () => {
  it('cancels into done with the given resolution and audits card.cancelled', async () => {
    const card = await createCard('Cancel me')

    const response = await act(card, 'cancel', { resolution: 'duplicate' })

    expect(response.statusCode).toBe(200)
    expect(response.json<CardBody>().resolution).toBe('duplicate')
    const event = await lastEvent(card.id)
    expect(event).toMatchObject({
      eventType: 'card.cancelled',
      payload: { resolution: 'duplicate', fromLane: 'intake' },
    })
  })

  it('409s a card already in done and 400s a bad resolution', async () => {
    const card = await createCard('Already done')
    const cancelled = await act(card, 'cancel', { resolution: 'cancelled' })

    const again = await act(cancelled.json<CardBody>(), 'cancel', { resolution: 'cancelled' })
    const invalid = await act(card, 'cancel', { resolution: 'completed' })

    expect(again.statusCode).toBe(409)
    expect(invalid.statusCode).toBe(400)
  })
})

describe('POST /cards/:id/reopen', () => {
  it('reopens a done card into ready, clearing the resolution', async () => {
    const card = await createCard('Reopen me')
    const cancelled = await act(card, 'cancel', { resolution: 'declined' })

    const response = await act(cancelled.json<CardBody>(), 'reopen')

    expect(response.statusCode).toBe(200)
    expect(response.json<CardBody>().resolution).toBeNull()
    const event = await lastEvent(card.id)
    expect(event).toMatchObject({ eventType: 'card.reopened', payload: { toLane: 'ready' } })
  })

  it('422s a card that is not in done, naming from and to', async () => {
    const card = await createCard('Not done yet')

    const response = await act(card, 'reopen')

    expect(response.statusCode).toBe(422)
    expect(response.json<{ from: string; to: string }>()).toMatchObject({
      from: 'intake',
      to: 'ready',
    })
  })
})

describe('POST /cards/:id/block + unblock', () => {
  it('raises and clears the blocked flag with audit events', async () => {
    const card = await createCard('Blocker')

    const blocked = await act(card, 'block', { reason: 'Room occupied' })
    expect(blocked.statusCode).toBe(200)
    expect(blocked.json<CardBody>()).toMatchObject({
      blocked: true,
      blockedReason: 'Room occupied',
    })
    expect(await lastEvent(card.id)).toMatchObject({
      eventType: 'card.blocked',
      payload: { reason: 'Room occupied' },
    })

    const unblocked = await act(blocked.json<CardBody>(), 'unblock')
    expect(unblocked.statusCode).toBe(200)
    expect(unblocked.json<CardBody>().blocked).toBe(false)
    expect((await lastEvent(card.id))?.eventType).toBe('card.unblocked')
  })

  it('409s double-block and unblocking an unblocked card; 400s a missing reason', async () => {
    const card = await createCard('Double blocker')
    const blocked = await act(card, 'block', { reason: 'First' })

    const doubleBlock = await act(blocked.json<CardBody>(), 'block', { reason: 'Second' })
    const noReason = await act(card, 'block', {})
    const notBlocked = await act(await createCard('Free'), 'unblock')
    const unblockTwice = await (async () => {
      const unblocked = await act(blocked.json<CardBody>(), 'unblock')
      return act(unblocked.json<CardBody>(), 'unblock')
    })()

    expect(doubleBlock.statusCode).toBe(409)
    expect(noReason.statusCode).toBe(400)
    expect(notBlocked.statusCode).toBe(409)
    expect(unblockTwice.statusCode).toBe(409)
  })
})

describe('archived cards are read-only', () => {
  it('409s card-archived on edits, comments, and moves', async () => {
    const card = await createCard('Archived')
    await t.wired.deps.uow.run(async (tx) => {
      const row = await tx.cards.findById(card.id)
      if (row) await tx.cards.update({ ...row, archivedAt: new Date().toISOString() })
    })

    const patch = await t.request(cookie, {
      method: 'PATCH',
      url: `/api/v1/cards/${card.id}`,
      headers: { 'if-match': '"1"' },
      payload: { title: 'Nope' },
    })
    const move = await act(card, 'move', { toLane: 'ready' })
    const comment = await t.request(cookie, {
      method: 'POST',
      url: `/api/v1/cards/${card.id}/comments`,
      payload: { body: 'Nope' },
    })

    for (const response of [patch, move, comment]) {
      expect(response.statusCode).toBe(409)
      expect(response.json<{ type: string }>().type).toBe('urn:rivian-kanban:problem:card-archived')
    }
  })
})
