import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestApp, type TestApp } from './test/support.ts'

/**
 * The card-relations REST surface (docs/architecture/card-relations.md): typed
 * links resolved to the other card + a viewing direction, created/listed/deleted
 * from EITHER card's side. Real Fastify app, real SQLite, real session auth.
 */

let t: TestApp
let cookie: string

beforeAll(async () => {
  t = await createTestApp()
  ;({ cookie } = await t.asRole('user'))
})

afterAll(async () => {
  await t.cleanup()
})

async function createCard(title: string): Promise<number> {
  const response = await t.request(cookie, {
    method: 'POST',
    url: '/api/v1/cards',
    payload: { title, priority: 'P2' },
  })
  if (response.statusCode !== 201) throw new Error(`create failed: ${response.body}`)
  return response.json<{ id: number }>().id
}

interface RelationView {
  id: string
  type: string
  direction: string
  card: { id: number; title: string }
}

describe('card relations REST', () => {
  it('creates a relation, lists it from BOTH sides with the right direction, then deletes it', async () => {
    // Arrange
    const from = await createCard('Repair panel')
    const to = await createCard('Order parts')

    // Act — `from` blocks `to`.
    const created = await t.request(cookie, {
      method: 'POST',
      url: `/api/v1/cards/${String(from)}/relations`,
      payload: { toCardId: to, type: 'blocks' },
    })

    // Assert — the creating card sees it outgoing at the target.
    expect(created.statusCode).toBe(201)
    const view = created.json<RelationView>()
    expect(view).toMatchObject({
      type: 'blocks',
      direction: 'outgoing',
      card: { id: to, title: 'Order parts' },
    })

    // The `to` card sees the SAME row as incoming (i.e. "blocked by") pointing back.
    const toList = await t.request(cookie, {
      method: 'GET',
      url: `/api/v1/cards/${String(to)}/relations`,
    })
    const incoming = toList.json<RelationView[]>().find((r) => r.direction === 'incoming')
    expect(incoming?.card.id).toBe(from)
    expect(incoming?.type).toBe('blocks')

    // Delete from the OTHER side and it is gone everywhere.
    const del = await t.request(cookie, {
      method: 'DELETE',
      url: `/api/v1/cards/${String(to)}/relations/${view.id}`,
    })
    expect(del.statusCode).toBe(204)
    const afterList = await t.request(cookie, {
      method: 'GET',
      url: `/api/v1/cards/${String(from)}/relations`,
    })
    expect(afterList.json<RelationView[]>()).toEqual([])
  })

  it('rejects a self-relation (409), a duplicate (409), and a missing target (404)', async () => {
    // Arrange
    const a = await createCard('A')
    const b = await createCard('B')

    // Act + Assert — a card cannot relate to itself.
    const selfRel = await t.request(cookie, {
      method: 'POST',
      url: `/api/v1/cards/${String(a)}/relations`,
      payload: { toCardId: a, type: 'relates_to' },
    })
    expect(selfRel.statusCode).toBe(409)

    // The same directed relation twice is a conflict.
    await t.request(cookie, {
      method: 'POST',
      url: `/api/v1/cards/${String(a)}/relations`,
      payload: { toCardId: b, type: 'blocks' },
    })
    const dup = await t.request(cookie, {
      method: 'POST',
      url: `/api/v1/cards/${String(a)}/relations`,
      payload: { toCardId: b, type: 'blocks' },
    })
    expect(dup.statusCode).toBe(409)

    // An unknown target card is a 404.
    const missing = await t.request(cookie, {
      method: 'POST',
      url: `/api/v1/cards/${String(a)}/relations`,
      payload: { toCardId: 999_999, type: 'blocks' },
    })
    expect(missing.statusCode).toBe(404)
  })

  it('404s deleting a relation whose card is not in the path', async () => {
    // Arrange — a relation between A and B, plus an unrelated card C.
    const a = await createCard('A2')
    const b = await createCard('B2')
    const c = await createCard('C2')
    const created = await t.request(cookie, {
      method: 'POST',
      url: `/api/v1/cards/${String(a)}/relations`,
      payload: { toCardId: b, type: 'blocks' },
    })
    const view = created.json<RelationView>()

    // Act — delete it via C's path (C is not part of the relation).
    const del = await t.request(cookie, {
      method: 'DELETE',
      url: `/api/v1/cards/${String(c)}/relations/${view.id}`,
    })

    // Assert
    expect(del.statusCode).toBe(404)
  })
})
