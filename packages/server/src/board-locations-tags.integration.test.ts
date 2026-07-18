import { LANE_KEYS } from '@rivian-kanban/core'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestApp, type TestApp } from './test/support.ts'

/**
 * GET /board (lanes + WIP state + position-ordered cards), the locations
 * tree with admin CRUD (strict hierarchy, recursive subtree deletes that
 * clear referencing cards), and the tags autocomplete list
 * (docs/architecture/rest-api.md).
 */

let t: TestApp
let adminCookie: string

beforeAll(async () => {
  t = await createTestApp()
  ;({ cookie: adminCookie } = await t.asRole('admin'))
})

afterAll(async () => {
  await t.cleanup()
})

interface LocationBody {
  id: string
  parentId: string | null
  kind: string
  name: string
}

async function createLocation(payload: Record<string, unknown>) {
  return t.request(adminCookie, { method: 'POST', url: '/api/v1/locations', payload })
}

describe('GET /board', () => {
  it('returns the 7 seeded lanes in order with cards in position order', async () => {
    const { cookie } = await t.asRole('user')
    const first = await t.request(cookie, {
      method: 'POST',
      url: '/api/v1/cards',
      payload: { title: 'Board card A' },
    })
    await t.request(cookie, {
      method: 'POST',
      url: '/api/v1/cards',
      payload: { title: 'Board card B' },
    })

    const response = await t.request(cookie, { method: 'GET', url: '/api/v1/board' })

    expect(response.statusCode).toBe(200)
    const board = response.json<{
      lanes: { lane: { key: string }; cards: { title: string }[]; wipLimitExceeded: boolean }[]
    }>()
    expect(board.lanes.map((entry) => entry.lane.key)).toEqual([...LANE_KEYS])
    const intake = board.lanes[0]
    // Creation lands at the top: B (newest) before A.
    expect(intake?.cards.map((card) => card.title)).toEqual(['Board card B', 'Board card A'])
    expect(intake?.wipLimitExceeded).toBe(false)
    expect(first.statusCode).toBe(201)
  })

  it('carries tag names, an attachment count, and the location label on each summary card', async () => {
    // A room to locate the card in (the leaf label the board card renders).
    const building = await createLocation({ kind: 'building', name: 'Summary Building' })
    const floor = await createLocation({
      kind: 'floor',
      name: 'Summary Floor',
      parentId: building.json<LocationBody>().id,
    })
    const room = await createLocation({
      kind: 'room',
      name: 'Summary Room 7',
      parentId: floor.json<LocationBody>().id,
    })
    const roomId = room.json<LocationBody>().id

    const created = await t.request(adminCookie, {
      method: 'POST',
      url: '/api/v1/cards',
      payload: {
        title: 'Summary-fields card',
        locationId: roomId,
        tags: ['HVAC', 'urgent'],
      },
    })
    expect(created.statusCode).toBe(201)

    const response = await t.request(adminCookie, { method: 'GET', url: '/api/v1/board' })

    const board = response.json<{
      lanes: {
        cards: {
          title: string
          tags: string[]
          attachmentCount: number
          locationLabel: string | null
        }[]
      }[]
    }>()
    const summary = board.lanes
      .flatMap((lane) => lane.cards)
      .find((card) => card.title === 'Summary-fields card')
    expect(summary?.tags.toSorted()).toEqual(['HVAC', 'urgent'])
    expect(summary?.locationLabel).toBe('Summary Room 7')
    // No uploads yet: the lean count is present and zero (never a full object).
    expect(summary?.attachmentCount).toBe(0)
  })
})

describe('PATCH /lanes/:id (admin)', () => {
  async function laneByKey(key: string): Promise<{ id: string; label: string }> {
    const response = await t.request(adminCookie, { method: 'GET', url: '/api/v1/board' })
    const lanes = response.json<{ lanes: { lane: { id: string; key: string; label: string } }[] }>()
      .lanes
    const found = lanes.find((entry) => entry.lane.key === key)
    if (found === undefined) throw new Error(`no lane with key ${key}`)
    return found.lane
  }

  it('edits label and WIP limit, publishes lane.updated, and the board reflects it', async () => {
    const lane = await laneByKey('review')
    const hints: string[] = []
    const unsubscribe = t.wired.deps.eventBus.subscribe((hint) => hints.push(hint.type))

    const response = await t.request(adminCookie, {
      method: 'PATCH',
      url: `/api/v1/lanes/${lane.id}`,
      payload: { label: 'Inspection', wipLimit: 3 },
    })
    unsubscribe()

    expect(response.statusCode).toBe(200)
    expect(response.json<{ label: string; wipLimit: number }>()).toMatchObject({
      label: 'Inspection',
      wipLimit: 3,
    })
    expect(hints).toContain('lane.updated')

    const board = await t.request(adminCookie, { method: 'GET', url: '/api/v1/board' })
    const entry = board
      .json<{ lanes: { lane: { key: string; label: string; wipLimit: number | null } }[] }>()
      .lanes.find((candidate) => candidate.lane.key === 'review')
    expect(entry?.lane).toMatchObject({ label: 'Inspection', wipLimit: 3 })
  })

  it('clears a WIP limit with null and flips wipLimitExceeded off', async () => {
    const lane = await laneByKey('in_progress') // seeded with a WIP limit

    const cleared = await t.request(adminCookie, {
      method: 'PATCH',
      url: `/api/v1/lanes/${lane.id}`,
      payload: { wipLimit: null },
    })

    expect(cleared.statusCode).toBe(200)
    expect(cleared.json<{ wipLimit: number | null }>().wipLimit).toBeNull()
  })

  it('requires manageLanes (403 named rule) and 404s unknown lanes', async () => {
    const technician = await t.asRole('user')
    const lane = await laneByKey('ready')

    const denied = await t.request(technician.cookie, {
      method: 'PATCH',
      url: `/api/v1/lanes/${lane.id}`,
      payload: { label: 'Nope' },
    })
    const missing = await t.request(adminCookie, {
      method: 'PATCH',
      url: '/api/v1/lanes/00000000-0000-7000-8000-00000000dead',
      payload: { label: 'Ghost' },
    })

    expect(denied.statusCode).toBe(403)
    expect(denied.json<{ rule: string }>().rule).toBe('permission:manageLanes')
    expect(missing.statusCode).toBe(404)
  })

  it('rejects an empty patch with 400', async () => {
    const lane = await laneByKey('done')

    const response = await t.request(adminCookie, {
      method: 'PATCH',
      url: `/api/v1/lanes/${lane.id}`,
      payload: {},
    })

    expect(response.statusCode).toBe(400)
    expect(response.json<{ type: string }>().type).toBe('urn:rivian-kanban:problem:validation')
  })
})

describe('GET /locations + admin CRUD', () => {
  it('lists the whole tree for any authenticated user', async () => {
    // A fresh install starts with zero locations (BUG 1), so arrange the tree.
    const building = await createLocation({ kind: 'building', name: 'List Building' })
    const floor = await createLocation({
      kind: 'floor',
      name: 'List Floor',
      parentId: building.json<LocationBody>().id,
    })
    await createLocation({
      kind: 'room',
      name: 'List Room',
      parentId: floor.json<LocationBody>().id,
    })
    const { cookie } = await t.asRole('user')

    const response = await t.request(cookie, { method: 'GET', url: '/api/v1/locations' })

    expect(response.statusCode).toBe(200)
    const kinds = new Set(response.json<LocationBody[]>().map((location) => location.kind))
    expect(kinds).toEqual(new Set(['building', 'floor', 'room']))
  })

  it('creates building → floor → room respecting the hierarchy', async () => {
    const building = await createLocation({ kind: 'building', name: 'New Building' })
    expect(building.statusCode).toBe(201)
    const buildingId = building.json<LocationBody>().id

    const floor = await createLocation({ kind: 'floor', name: 'Floor 9', parentId: buildingId })
    expect(floor.statusCode).toBe(201)

    const room = await createLocation({
      kind: 'room',
      name: 'Room 901',
      parentId: floor.json<LocationBody>().id,
    })
    expect(room.statusCode).toBe(201)
  })

  it('rejects hierarchy violations with 400 and unknown parents with 404', async () => {
    const building = await createLocation({ kind: 'building', name: 'Hierarchy Test' })
    const buildingId = building.json<LocationBody>().id

    const floorWithoutParent = await createLocation({ kind: 'floor', name: 'Orphan floor' })
    const roomUnderBuilding = await createLocation({
      kind: 'room',
      name: 'Bad room',
      parentId: buildingId,
    })
    const buildingWithParent = await createLocation({
      kind: 'building',
      name: 'Nested building',
      parentId: buildingId,
    })
    const ghostParent = await createLocation({
      kind: 'floor',
      name: 'Ghost parent',
      parentId: '00000000-0000-7000-8000-00000000dead',
    })

    expect(floorWithoutParent.statusCode).toBe(400)
    expect(roomUnderBuilding.statusCode).toBe(400)
    expect(buildingWithParent.statusCode).toBe(400)
    expect(ghostParent.statusCode).toBe(404)
  })

  it('renames locations and 404s unknown ids', async () => {
    const created = await createLocation({ kind: 'building', name: 'Rename me' })
    const id = created.json<LocationBody>().id

    const renamed = await t.request(adminCookie, {
      method: 'PATCH',
      url: `/api/v1/locations/${id}`,
      payload: { name: 'Renamed Building' },
    })
    const missing = await t.request(adminCookie, {
      method: 'PATCH',
      url: '/api/v1/locations/00000000-0000-7000-8000-00000000dead',
      payload: { name: 'Ghost' },
    })

    expect(renamed.statusCode).toBe(200)
    expect(renamed.json<LocationBody>().name).toBe('Renamed Building')
    expect(missing.statusCode).toBe(404)
  })

  it('rejects a duplicate sibling name (case-insensitive) on create, allowing it under a different parent', async () => {
    // Two buildings so we can prove the check is scoped to siblings, not global.
    const buildingA = await createLocation({ kind: 'building', name: 'Dup Building A' })
    const buildingB = await createLocation({ kind: 'building', name: 'Dup Building B' })
    const parentA = buildingA.json<LocationBody>().id
    const parentB = buildingB.json<LocationBody>().id

    const first = await createLocation({ kind: 'floor', name: 'Level 1', parentId: parentA })
    expect(first.statusCode).toBe(201)

    // Same name, same parent, differing only in case → rejected as a conflict.
    const dupSameCase = await createLocation({ kind: 'floor', name: 'Level 1', parentId: parentA })
    const dupOtherCase = await createLocation({ kind: 'floor', name: 'level 1', parentId: parentA })
    expect(dupSameCase.statusCode).toBe(409)
    expect(dupSameCase.json<{ type: string }>().type).toBe('urn:rivian-kanban:problem:conflict')
    expect(dupOtherCase.statusCode).toBe(409)

    // The same name under a DIFFERENT parent is allowed.
    const differentParent = await createLocation({
      kind: 'floor',
      name: 'Level 1',
      parentId: parentB,
    })
    expect(differentParent.statusCode).toBe(201)
  })

  it('rejects renaming a location onto an existing sibling name (case-insensitive)', async () => {
    const building = await createLocation({ kind: 'building', name: 'Rename Conflict Building' })
    const parent = building.json<LocationBody>().id
    await createLocation({ kind: 'floor', name: 'Alpha', parentId: parent })
    const beta = await createLocation({ kind: 'floor', name: 'Beta', parentId: parent })
    const betaId = beta.json<LocationBody>().id

    // Rename Beta → "alpha" (differs only in case from its sibling) → conflict.
    const collision = await t.request(adminCookie, {
      method: 'PATCH',
      url: `/api/v1/locations/${betaId}`,
      payload: { name: 'alpha' },
    })
    expect(collision.statusCode).toBe(409)
    expect(collision.json<{ type: string }>().type).toBe('urn:rivian-kanban:problem:conflict')

    // Renaming a location to its own current name is a no-op, not a self-conflict.
    const noop = await t.request(adminCookie, {
      method: 'PATCH',
      url: `/api/v1/locations/${betaId}`,
      payload: { name: 'Beta' },
    })
    expect(noop.statusCode).toBe(200)
    expect(noop.json<LocationBody>().name).toBe('Beta')
  })

  it('recursively deletes a building with floors + rooms and clears referencing cards', async () => {
    // BUG 2: deleting a building removes its whole subtree in one transaction;
    // a card that referenced a removed room keeps its row with location cleared.
    const building = await createLocation({ kind: 'building', name: 'Delete tests' })
    const buildingId = building.json<LocationBody>().id
    const floor = await createLocation({ kind: 'floor', name: 'F1', parentId: buildingId })
    const floorId = floor.json<LocationBody>().id
    const room = await createLocation({ kind: 'room', name: 'R1', parentId: floorId })
    const roomId = room.json<LocationBody>().id

    const created = await t.request(adminCookie, {
      method: 'POST',
      url: '/api/v1/cards',
      payload: { title: 'Located card', locationId: roomId },
    })
    const cardId = created.json<{ id: string }>().id

    const parentDelete = await t.request(adminCookie, {
      method: 'DELETE',
      url: `/api/v1/locations/${buildingId}`,
    })
    expect(parentDelete.statusCode).toBe(204)

    // The whole subtree is gone.
    const listed = await t.request(adminCookie, { method: 'GET', url: '/api/v1/locations' })
    const survivingIds = new Set(listed.json<LocationBody[]>().map((location) => location.id))
    expect(survivingIds.has(buildingId)).toBe(false)
    expect(survivingIds.has(floorId)).toBe(false)
    expect(survivingIds.has(roomId)).toBe(false)

    // The card survives with its optional location cleared.
    const detail = await t.request(adminCookie, {
      method: 'GET',
      url: `/api/v1/cards/${cardId}`,
    })
    expect(detail.statusCode).toBe(200)
    expect(detail.json<{ card: { id: string }; location: unknown }>().location).toBeNull()
  })

  it('deletes a leaf room removing only it, and 404s a missing id', async () => {
    const building = await createLocation({ kind: 'building', name: 'Leaf tests' })
    const buildingId = building.json<LocationBody>().id
    const floor = await createLocation({ kind: 'floor', name: 'LF', parentId: buildingId })
    const floorId = floor.json<LocationBody>().id
    const room = await createLocation({ kind: 'room', name: 'LR', parentId: floorId })
    const roomId = room.json<LocationBody>().id

    const leafDelete = await t.request(adminCookie, {
      method: 'DELETE',
      url: `/api/v1/locations/${roomId}`,
    })
    expect(leafDelete.statusCode).toBe(204)

    // Ancestors remain.
    const listed = await t.request(adminCookie, { method: 'GET', url: '/api/v1/locations' })
    const survivingIds = new Set(listed.json<LocationBody[]>().map((location) => location.id))
    expect(survivingIds.has(buildingId)).toBe(true)
    expect(survivingIds.has(floorId)).toBe(true)
    expect(survivingIds.has(roomId)).toBe(false)

    const missing = await t.request(adminCookie, {
      method: 'DELETE',
      url: '/api/v1/locations/00000000-0000-7000-8000-0000000004ff',
    })
    expect(missing.statusCode).toBe(404)
  })

  it('restricts CRUD to admins (403) while reads stay open', async () => {
    const requester = await t.asRole('user')

    const create = await t.request(requester.cookie, {
      method: 'POST',
      url: '/api/v1/locations',
      payload: { kind: 'building', name: 'Nope' },
    })
    const patch = await t.request(requester.cookie, {
      method: 'PATCH',
      url: '/api/v1/locations/00000000-0000-7000-8000-000000000001',
      payload: { name: 'Nope' },
    })
    const remove = await t.request(requester.cookie, {
      method: 'DELETE',
      url: '/api/v1/locations/00000000-0000-7000-8000-000000000001',
    })

    expect(create.statusCode).toBe(403)
    expect(patch.statusCode).toBe(403)
    expect(remove.statusCode).toBe(403)
  })
})

describe('GET /tags', () => {
  it('lists known tags for autocomplete after they are first used', async () => {
    const { cookie } = await t.asRole('user')
    await t.request(cookie, {
      method: 'POST',
      url: '/api/v1/cards',
      payload: { title: 'Tagged work', tags: ['Zamboni', 'abseiling'] },
    })

    const response = await t.request(cookie, { method: 'GET', url: '/api/v1/tags' })

    expect(response.statusCode).toBe(200)
    const names = response.json<{ name: string }[]>().map((tag) => tag.name)
    expect(names).toContain('Zamboni')
    expect(names).toContain('abseiling')
  })
})

describe('GET /lanes', () => {
  it('returns the 7 board lanes in position order (any authenticated user)', async () => {
    const { cookie } = await t.asRole('user')

    const response = await t.request(cookie, { method: 'GET', url: '/api/v1/lanes' })

    expect(response.statusCode).toBe(200)
    const lanes = response.json<{ key: string; label: string; position: number }[]>()
    expect(lanes.map((lane) => lane.key)).toEqual([...LANE_KEYS])
    const positions = lanes.map((lane) => lane.position)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })
})

describe('GET /events (board-wide activity feed)', () => {
  it('returns board-wide events since a timestamp, newest-first, filterable by type', async () => {
    const { cookie } = await t.asRole('user')
    const before = new Date().toISOString()
    const created = await t.request(cookie, {
      method: 'POST',
      url: '/api/v1/cards',
      payload: { title: 'Activity feed card' },
    })
    const cardId = created.json<{ id: string }>().id

    const feed = await t.request(cookie, {
      method: 'GET',
      url: `/api/v1/events?since=${encodeURIComponent(before)}`,
    })
    const createdOnly = await t.request(cookie, {
      method: 'GET',
      url: `/api/v1/events?since=${encodeURIComponent(before)}&type=card.created&cardId=${cardId}`,
    })

    expect(feed.statusCode).toBe(200)
    const items = feed.json<{ items: { eventType: string; createdAt: string; cardId: string }[] }>()
      .items
    expect(items.some((event) => event.cardId === cardId)).toBe(true)
    // Newest-first: the timestamps already come sorted descending.
    const timestamps = items.map((event) => event.createdAt)
    expect(timestamps).toEqual([...timestamps].sort((a, b) => (a < b ? 1 : -1)))
    const filtered = createdOnly.json<{ items: { eventType: string; cardId: string }[] }>().items
    expect(filtered.map((event) => event.eventType)).toEqual(['card.created'])
    expect(filtered[0]?.cardId).toBe(cardId)
  })

  it('defaults `since` to 24 hours ago, excluding older events', async () => {
    const { cookie } = await t.asRole('user')
    // A card whose creation event we backdate two days — outside the default window.
    const created = await t.request(cookie, {
      method: 'POST',
      url: '/api/v1/cards',
      payload: { title: 'Ancient history card' },
    })
    const cardId = created.json<{ id: string }>().id
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
    // Backdate this card's events directly — the audit trail is append-only, so
    // the port has no update method; a raw write is the honest test arrange.
    t.wired.connection.db.run(
      sql`UPDATE card_events SET created_at = ${twoDaysAgo} WHERE card_id = ${cardId}`,
    )

    const defaulted = await t.request(cookie, { method: 'GET', url: '/api/v1/events' })

    const ids = defaulted.json<{ items: { cardId: string }[] }>().items.map((e) => e.cardId)
    expect(ids).not.toContain(cardId)
  })

  it('honors actorKind, limit, and the cursor across pages', async () => {
    const { cookie } = await t.asRole('user')
    const before = new Date().toISOString()
    // Two user-actor events (card creations) guarantee a second keyset page.
    await t.request(cookie, { method: 'POST', url: '/api/v1/cards', payload: { title: 'Feed A' } })
    await t.request(cookie, { method: 'POST', url: '/api/v1/cards', payload: { title: 'Feed B' } })

    const page = (query: string) =>
      t.request(cookie, {
        method: 'GET',
        url: `/api/v1/events?since=${encodeURIComponent(before)}&actorKind=user&${query}`,
      })
    const first = await page('limit=1')
    const firstBody = first.json<{ items: { actorKind: string }[]; nextCursor: string | null }>()
    const second = await page(`limit=1&cursor=${encodeURIComponent(firstBody.nextCursor ?? '')}`)

    expect(firstBody.items).toHaveLength(1)
    expect(firstBody.items.every((event) => event.actorKind === 'user')).toBe(true)
    expect(firstBody.nextCursor).not.toBeNull()
    expect(second.json<{ items: unknown[] }>().items).toHaveLength(1)
  })

  it('400s an invalid `since` (not an ISO datetime)', async () => {
    const { cookie } = await t.asRole('user')

    const response = await t.request(cookie, {
      method: 'GET',
      url: '/api/v1/events?since=not-a-date',
    })

    expect(response.statusCode).toBe(400)
    expect(response.json<{ type: string }>().type).toBe('urn:rivian-kanban:problem:validation')
  })
})
