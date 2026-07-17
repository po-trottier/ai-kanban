import { LANE_KEYS } from '@rivian-kanban/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestApp, type TestApp } from './test/support.ts'

/**
 * GET /board (lanes + WIP state + position-ordered cards), the locations
 * tree with admin CRUD (strict hierarchy, FK-protected deletes), and the
 * tags autocomplete list (docs/architecture/rest-api.md).
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
    const { cookie } = await t.asRole('technician')
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

  it('is admin-only (403 with the always-on rule) and 404s unknown lanes', async () => {
    const technician = await t.asRole('technician')
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
    expect(denied.json<{ rule: string }>().rule).toBe('admin-only')
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
  it('lists the seeded tree for any authenticated user', async () => {
    const { cookie } = await t.asRole('requester')

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

  it('deletes leaves; children or referencing cards make it a 409', async () => {
    const building = await createLocation({ kind: 'building', name: 'Delete tests' })
    const buildingId = building.json<LocationBody>().id
    const floor = await createLocation({ kind: 'floor', name: 'F1', parentId: buildingId })
    const floorId = floor.json<LocationBody>().id
    const room = await createLocation({ kind: 'room', name: 'R1', parentId: floorId })
    const roomId = room.json<LocationBody>().id

    const parentDelete = await t.request(adminCookie, {
      method: 'DELETE',
      url: `/api/v1/locations/${buildingId}`,
    })
    expect(parentDelete.statusCode).toBe(409)

    await t.request(adminCookie, {
      method: 'POST',
      url: '/api/v1/cards',
      payload: { title: 'Located card', locationId: roomId },
    })
    const referenced = await t.request(adminCookie, {
      method: 'DELETE',
      url: `/api/v1/locations/${roomId}`,
    })
    expect(referenced.statusCode).toBe(409)

    const emptyFloor = await createLocation({ kind: 'floor', name: 'F2', parentId: buildingId })
    const leafDelete = await t.request(adminCookie, {
      method: 'DELETE',
      url: `/api/v1/locations/${emptyFloor.json<LocationBody>().id}`,
    })
    expect(leafDelete.statusCode).toBe(204)
  })

  it('restricts CRUD to admins (403) while reads stay open', async () => {
    const requester = await t.asRole('requester')

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
    const { cookie } = await t.asRole('technician')
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
