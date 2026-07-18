import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestApp, type TestApp } from './test/support.ts'

/**
 * Card CRUD, listing/filtering, cursor pagination, optimistic locking
 * (If-Match/ETag, ADR-012), and audit events asserted through the real
 * GET /cards/:id/events route (docs/dev/testing.md definition of done).
 */

let t: TestApp

beforeAll(async () => {
  t = await createTestApp()
})

afterAll(async () => {
  await t.cleanup()
})

interface CardBody {
  id: string
  title: string
  version: number
  priority: string
  description: string
  laneId: string
  reporterId: string
  origin: string
  [key: string]: unknown
}

async function createCard(cookie: string, payload: Record<string, unknown>): Promise<CardBody> {
  const response = await t.request(cookie, { method: 'POST', url: '/api/v1/cards', payload })
  if (response.statusCode !== 201) throw new Error(`create failed: ${response.body}`)
  return response.json<CardBody>()
}

/** Arranges a building → floor → room and returns the room (admin cookie). */
async function createRoom(cookie: string): Promise<{ id: string }> {
  const location = async (payload: Record<string, unknown>): Promise<{ id: string }> => {
    const response = await t.request(cookie, {
      method: 'POST',
      url: '/api/v1/locations',
      payload,
    })
    if (response.statusCode !== 201) throw new Error(`location create failed: ${response.body}`)
    return response.json<{ id: string }>()
  }
  const building = await location({ kind: 'building', name: 'Cards Building' })
  const floor = await location({ kind: 'floor', name: 'Cards Floor', parentId: building.id })
  return location({ kind: 'room', name: 'Cards Room', parentId: floor.id })
}

async function eventsOf(cookie: string, cardId: string) {
  const response = await t.request(cookie, {
    method: 'GET',
    url: `/api/v1/cards/${cardId}/events`,
  })
  return response.json<{
    items: {
      eventType: string
      actorKind: string
      actorId: string | null
      payload: Record<string, unknown>
    }[]
  }>().items
}

describe('POST /cards', () => {
  it('creates in intake with documented defaults, reporter = acting user, ETag "1"', async () => {
    const { user, cookie } = await t.asRole('user')

    const response = await t.request(cookie, {
      method: 'POST',
      url: '/api/v1/cards',
      payload: { title: 'Leaky faucet' },
    })

    expect(response.statusCode).toBe(201)
    expect(response.headers.etag).toBe('"1"')
    const card = response.json<CardBody>()
    expect(card).toMatchObject({
      title: 'Leaky faucet',
      description: '',
      priority: 'P2',
      origin: 'manual',
      reporterId: user.id,
      version: 1,
    })
  })

  it('writes a card.created audit event with a full snapshot', async () => {
    const { user, cookie } = await t.asRole('user')
    const card = await createCard(cookie, { title: 'Audit me', tags: ['HVAC'] })

    const events = await eventsOf(cookie, card.id)

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      eventType: 'card.created',
      actorKind: 'user',
      actorId: user.id,
    })
    const snapshot = events[0]?.payload.snapshot as { title: string; tags: string[] }
    expect(snapshot.title).toBe('Audit me')
    expect(snapshot.tags).toEqual(['HVAC'])
  })

  it('rejects a missing title (400) and an unknown assignee (404)', async () => {
    const { cookie } = await t.asRole('user')

    const invalid = await t.request(cookie, { method: 'POST', url: '/api/v1/cards', payload: {} })
    const ghost = await t.request(cookie, {
      method: 'POST',
      url: '/api/v1/cards',
      payload: { title: 'x', assigneeId: '00000000-0000-7000-8000-00000000dead' },
    })

    expect(invalid.statusCode).toBe(400)
    expect(invalid.json<{ issues: { path: string }[] }>().issues.length).toBeGreaterThan(0)
    expect(ghost.statusCode).toBe(404)
  })

  it('rejects unknown body keys (strict schemas)', async () => {
    const { cookie } = await t.asRole('user')

    const response = await t.request(cookie, {
      method: 'POST',
      url: '/api/v1/cards',
      payload: { title: 'x', reporterId: '00000000-0000-7000-8000-000000000001' },
    })

    expect(response.statusCode).toBe(400)
  })
})

describe('GET /cards/:id', () => {
  it('returns full detail with tags, location, attachments, and an ETag', async () => {
    const admin = await t.asRole('admin')
    // A fresh install starts with zero locations (BUG 1), so arrange a room.
    const room = await createRoom(admin.cookie)
    const card = await createCard(admin.cookie, {
      title: 'Detailed',
      tags: ['plumbing', 'urgent'],
      locationId: room.id,
    })

    const response = await t.request(admin.cookie, {
      method: 'GET',
      url: `/api/v1/cards/${card.id}`,
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers.etag).toBe('"1"')
    const detail = response.json<{
      card: CardBody
      tags: { name: string }[]
      location: { id: string } | null
      attachments: unknown[]
    }>()
    expect(detail.card.id).toBe(card.id)
    expect(detail.tags.map((tag) => tag.name).sort()).toEqual(['plumbing', 'urgent'])
    expect(detail.location?.id).toBe(room.id)
    expect(detail.attachments).toEqual([])
  })

  it('404s an unknown card and 400s a non-uuid id', async () => {
    const { cookie } = await t.asRole('user')

    const missing = await t.request(cookie, {
      method: 'GET',
      url: '/api/v1/cards/00000000-0000-7000-8000-00000000dead',
    })
    const invalid = await t.request(cookie, { method: 'GET', url: '/api/v1/cards/not-a-uuid' })

    expect(missing.statusCode).toBe(404)
    expect(invalid.statusCode).toBe(400)
  })

  it('resolves the human ticket number to the same card (/cards/<number> deep-link)', async () => {
    const { cookie } = await t.asRole('user')
    const card = await createCard(cookie, { title: 'By number' })

    const byNumber = await t.request(cookie, {
      method: 'GET',
      url: `/api/v1/cards/${String(card.number)}`,
    })

    expect(byNumber.statusCode).toBe(200)
    expect(byNumber.json<{ card: CardBody }>().card.id).toBe(card.id)
    expect(byNumber.headers.etag).toBe('"1"')
  })

  it('404s an unknown ticket number', async () => {
    const { cookie } = await t.asRole('user')

    const response = await t.request(cookie, { method: 'GET', url: '/api/v1/cards/999999' })

    expect(response.statusCode).toBe(404)
  })
})

describe('PATCH /cards/:id', () => {
  it('applies field edits, bumps the version, and audits one event per field', async () => {
    const { cookie } = await t.asRole('user')
    const card = await createCard(cookie, { title: 'Before', description: 'old' })

    const response = await t.request(cookie, {
      method: 'PATCH',
      url: `/api/v1/cards/${card.id}`,
      headers: { 'if-match': '"1"' },
      payload: { title: 'After', priority: 'P0' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers.etag).toBe('"2"')
    expect(response.json<CardBody>()).toMatchObject({ title: 'After', priority: 'P0', version: 2 })

    const events = await eventsOf(cookie, card.id)
    const changes = events.filter((event) => event.eventType === 'card.field_changed')
    expect(changes.map((event) => event.payload.field).sort()).toEqual(['priority', 'title'])
  })

  it('replaces tags as a full set', async () => {
    const { cookie } = await t.asRole('user')
    const card = await createCard(cookie, { title: 'Tagged', tags: ['a', 'b'] })

    await t.request(cookie, {
      method: 'PATCH',
      url: `/api/v1/cards/${card.id}`,
      headers: { 'if-match': '"1"' },
      payload: { tags: ['b', 'c'] },
    })

    const detail = await t.request(cookie, { method: 'GET', url: `/api/v1/cards/${card.id}` })
    const names = detail.json<{ tags: { name: string }[] }>().tags.map((tag) => tag.name)
    expect(names.sort()).toEqual(['b', 'c'])
  })

  it('409s a stale If-Match with the current card in the body', async () => {
    const { cookie } = await t.asRole('user')
    const card = await createCard(cookie, { title: 'Contended' })
    await t.request(cookie, {
      method: 'PATCH',
      url: `/api/v1/cards/${card.id}`,
      headers: { 'if-match': '"1"' },
      payload: { title: 'First writer wins' },
    })

    const stale = await t.request(cookie, {
      method: 'PATCH',
      url: `/api/v1/cards/${card.id}`,
      headers: { 'if-match': '"1"' },
      payload: { title: 'Second writer loses' },
    })

    expect(stale.statusCode).toBe(409)
    const body = stale.json<{ current: { title: string; version: number } }>()
    expect(body.current.title).toBe('First writer wins')
    expect(body.current.version).toBe(2)
  })

  it('400s a missing or malformed If-Match header', async () => {
    const { cookie } = await t.asRole('user')
    const card = await createCard(cookie, { title: 'Locked' })

    const missing = await t.request(cookie, {
      method: 'PATCH',
      url: `/api/v1/cards/${card.id}`,
      payload: { title: 'x' },
    })
    const malformed = await t.request(cookie, {
      method: 'PATCH',
      url: `/api/v1/cards/${card.id}`,
      headers: { 'if-match': '"abc"' },
      payload: { title: 'x' },
    })

    expect(missing.statusCode).toBe(400)
    expect(malformed.statusCode).toBe(400)
  })
})

describe('GET /cards — filters', () => {
  it('filters by lane, priority, assignee, q, and blocked', async () => {
    const solo = await createTestApp()
    try {
      const { user, cookie } = await solo.asRole('user')
      const p0 = await solo.request(cookie, {
        method: 'POST',
        url: '/api/v1/cards',
        payload: { title: 'Compressor overhaul', priority: 'P0', assigneeId: user.id },
      })
      const p0Card = p0.json<CardBody>()
      await solo.request(cookie, {
        method: 'POST',
        url: '/api/v1/cards',
        payload: { title: 'Paint hallway', priority: 'P2' },
      })
      await solo.request(cookie, {
        method: 'POST',
        url: `/api/v1/cards/${p0Card.id}/block`,
        headers: { 'if-match': '"1"' },
        payload: { reason: 'Parts missing' },
      })

      const byPriority = await solo.request(cookie, {
        method: 'GET',
        url: '/api/v1/cards?priority=P0',
      })
      const byAssignee = await solo.request(cookie, {
        method: 'GET',
        url: `/api/v1/cards?assignee=${user.id}`,
      })
      const byQ = await solo.request(cookie, { method: 'GET', url: '/api/v1/cards?q=compressor' })
      const byBlocked = await solo.request(cookie, {
        method: 'GET',
        url: '/api/v1/cards?blocked=true',
      })
      const byLane = await solo.request(cookie, { method: 'GET', url: '/api/v1/cards?lane=intake' })

      for (const response of [byPriority, byAssignee, byQ, byBlocked]) {
        const items = response.json<{ items: CardBody[] }>().items
        expect(items.map((card) => card.id)).toEqual([p0Card.id])
      }
      expect(byLane.json<{ items: CardBody[] }>().items).toHaveLength(2)
    } finally {
      await solo.cleanup()
    }
  })

  it('filters by locationId recursively (a building matches cards in its rooms)', async () => {
    const solo = await createTestApp()
    try {
      const { cookie: adminCookie } = await solo.asRole('admin')
      const { cookie } = await solo.asRole('user')
      // Build a minimal building → floor → room to place one card in.
      const building = await solo.request(adminCookie, {
        method: 'POST',
        url: '/api/v1/locations',
        payload: { kind: 'building', name: 'Filter Building' },
      })
      const buildingId = building.json<{ id: string }>().id
      const floor = await solo.request(adminCookie, {
        method: 'POST',
        url: '/api/v1/locations',
        payload: { kind: 'floor', name: 'Filter Floor', parentId: buildingId },
      })
      const floorId = floor.json<{ id: string }>().id
      const room = await solo.request(adminCookie, {
        method: 'POST',
        url: '/api/v1/locations',
        payload: { kind: 'room', name: 'Filter Room', parentId: floorId },
      })
      const roomId = room.json<{ id: string }>().id

      const located = await solo.request(cookie, {
        method: 'POST',
        url: '/api/v1/cards',
        payload: { title: 'In the room', locationId: roomId },
      })
      const locatedId = located.json<CardBody>().id
      await solo.request(cookie, {
        method: 'POST',
        url: '/api/v1/cards',
        payload: { title: 'Nowhere in particular' },
      })

      // Every level of the tree — room, floor, and building — matches the card
      // pinned to the leaf room: the filter is recursively inclusive.
      for (const locationId of [roomId, floorId, buildingId]) {
        const byLocation = await solo.request(cookie, {
          method: 'GET',
          url: `/api/v1/cards?locationId=${locationId}`,
        })
        expect(byLocation.json<{ items: CardBody[] }>().items.map((card) => card.id)).toEqual([
          locatedId,
        ])
      }
    } finally {
      await solo.cleanup()
    }
  })

  it('filters by tags with any-of semantics', async () => {
    const solo = await createTestApp()
    try {
      const { cookie } = await solo.asRole('user')
      const hvac = await solo.request(cookie, {
        method: 'POST',
        url: '/api/v1/cards',
        payload: { title: 'HVAC work', tags: ['HVAC'] },
      })
      const hvacId = hvac.json<CardBody>().id
      const plumbing = await solo.request(cookie, {
        method: 'POST',
        url: '/api/v1/cards',
        payload: { title: 'Plumbing work', tags: ['plumbing'] },
      })
      const plumbingId = plumbing.json<CardBody>().id
      await solo.request(cookie, {
        method: 'POST',
        url: '/api/v1/cards',
        payload: { title: 'Untagged work' },
      })

      // Any-of: a card carrying at least one of the requested tags matches.
      const byTags = await solo.request(cookie, {
        method: 'GET',
        url: '/api/v1/cards?tags=HVAC&tags=plumbing',
      })
      const ids = new Set(byTags.json<{ items: CardBody[] }>().items.map((card) => card.id))
      expect(ids).toEqual(new Set([hvacId, plumbingId]))
    } finally {
      await solo.cleanup()
    }
  })

  it('excludes archived cards unless includeArchived=true', async () => {
    const solo = await createTestApp()
    try {
      const { cookie } = await solo.asRole('user')
      const created = await solo.request(cookie, {
        method: 'POST',
        url: '/api/v1/cards',
        payload: { title: 'Old work' },
      })
      const card = created.json<CardBody>()
      // Arrange directly: archival is the daily job's write (a later task).
      await solo.wired.deps.uow.run(async (tx) => {
        const row = await tx.cards.findById(card.id)
        if (row) await tx.cards.update({ ...row, archivedAt: new Date().toISOString() })
      })

      // A second, still-active card so the three scopes are distinguishable.
      const active = await solo.request(cookie, {
        method: 'POST',
        url: '/api/v1/cards',
        payload: { title: 'Fresh work' },
      })
      const activeId = active.json<CardBody>().id

      const withoutFlag = await solo.request(cookie, { method: 'GET', url: '/api/v1/cards' })
      const withFlag = await solo.request(cookie, {
        method: 'GET',
        url: '/api/v1/cards?includeArchived=true',
      })
      const archivedOnly = await solo.request(cookie, {
        method: 'GET',
        url: '/api/v1/cards?archivedOnly=true',
      })

      // active only → the fresh card, not the archived one.
      expect(withoutFlag.json<{ items: CardBody[] }>().items.map((c) => c.id)).toEqual([activeId])
      // both → active and archived.
      expect(new Set(withFlag.json<{ items: CardBody[] }>().items.map((c) => c.id))).toEqual(
        new Set([activeId, card.id]),
      )
      // archived only → just the archived card.
      expect(archivedOnly.json<{ items: CardBody[] }>().items.map((c) => c.id)).toEqual([card.id])
    } finally {
      await solo.cleanup()
    }
  })
})

describe('GET /cards — cursor pagination', () => {
  it('round-trips pages newest-first with an opaque cursor', async () => {
    const solo = await createTestApp()
    try {
      const { cookie } = await solo.asRole('user')
      for (let index = 0; index < 5; index += 1) {
        await solo.request(cookie, {
          method: 'POST',
          url: '/api/v1/cards',
          payload: { title: `Card ${String(index)}` },
        })
      }

      const seen: string[] = []
      let cursor: string | null = null
      let pages = 0
      do {
        const url: string =
          cursor === null ? '/api/v1/cards?limit=2' : `/api/v1/cards?limit=2&cursor=${cursor}`
        const response = await solo.request(cookie, { method: 'GET', url })
        expect(response.statusCode).toBe(200)
        const page = response.json<{ items: CardBody[]; nextCursor: string | null }>()
        seen.push(...page.items.map((card) => card.title))
        cursor = page.nextCursor
        pages += 1
      } while (cursor !== null)

      expect(pages).toBe(3)
      expect(seen).toEqual(['Card 4', 'Card 3', 'Card 2', 'Card 1', 'Card 0'])
    } finally {
      await solo.cleanup()
    }
  })

  it('rejects a limit above 200 and a malformed cursor with 400', async () => {
    const { cookie } = await t.asRole('user')

    const tooBig = await t.request(cookie, { method: 'GET', url: '/api/v1/cards?limit=300' })
    const badCursor = await t.request(cookie, {
      method: 'GET',
      url: '/api/v1/cards?cursor=%%%not-a-cursor',
    })

    expect(tooBig.statusCode).toBe(400)
    expect(badCursor.statusCode).toBe(400)
  })
})

describe('GET /cards/:id/events', () => {
  it('pages oldest-first and filters by type', async () => {
    const { cookie } = await t.asRole('user')
    const card = await createCard(cookie, { title: 'Busy card' })
    for (const title of ['One', 'Two', 'Three']) {
      await t.request(cookie, {
        method: 'PATCH',
        url: `/api/v1/cards/${card.id}`,
        headers: { 'if-match': `"${String(await currentVersion(cookie, card.id))}"` },
        payload: { title },
      })
    }

    const firstPage = await t.request(cookie, {
      method: 'GET',
      url: `/api/v1/cards/${card.id}/events?limit=2`,
    })
    const page = firstPage.json<{ items: { eventType: string }[]; nextCursor: string | null }>()
    expect(page.items).toHaveLength(2)
    expect(page.items[0]?.eventType).toBe('card.created')
    expect(page.nextCursor).not.toBeNull()

    const rest = await t.request(cookie, {
      method: 'GET',
      url: `/api/v1/cards/${card.id}/events?limit=10&cursor=${page.nextCursor ?? ''}`,
    })
    expect(rest.json<{ items: unknown[] }>().items).toHaveLength(2)

    const filtered = await t.request(cookie, {
      method: 'GET',
      url: `/api/v1/cards/${card.id}/events?type=card.field_changed`,
    })
    expect(
      filtered
        .json<{ items: { eventType: string }[] }>()
        .items.every((event) => event.eventType === 'card.field_changed'),
    ).toBe(true)
  })

  it('404s an unknown card', async () => {
    const { cookie } = await t.asRole('user')

    const response = await t.request(cookie, {
      method: 'GET',
      url: '/api/v1/cards/00000000-0000-7000-8000-00000000dead/events',
    })

    expect(response.statusCode).toBe(404)
  })
})

async function currentVersion(cookie: string, cardId: string): Promise<number> {
  const detail = await t.request(cookie, { method: 'GET', url: `/api/v1/cards/${cardId}` })
  return detail.json<{ card: { version: number } }>().card.version
}
