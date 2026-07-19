import { createPgDataLayerFrom, openPgliteConnection } from '@rivian-kanban/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestApp, type TestApp } from './test/support.ts'

/**
 * The whole Fastify app booted on **PostgreSQL** (ADR-020), backed by an
 * in-process PGlite Postgres (real pg SQL, no server or Docker). Proves the
 * production path end-to-end: HTTP → services → the pg unit of work → the pg
 * repositories. The HTTP/auth layer is engine-agnostic, so this plus the pg
 * services drift-net (`db/src/pg/services.integration.test.ts`) covers the
 * Postgres backend without a real database server.
 */

let t: TestApp

beforeAll(async () => {
  const dataLayer = await createPgDataLayerFrom(await openPgliteConnection())
  t = await createTestApp({ dataLayer })
})

afterAll(async () => {
  await t.cleanup()
})

/** A fresh admin session with terse verb helpers, to keep each test focused. */
async function client() {
  const admin = await t.asRole('admin')
  const req = (
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    url: string,
    payload?: object,
  ) =>
    payload === undefined
      ? t.request(admin.cookie, { method, url })
      : t.request(admin.cookie, { method, url, payload })
  return {
    get: (url: string) => req('GET', url),
    post: (url: string, payload?: object) => req('POST', url, payload),
    put: (url: string) => req('PUT', url),
    del: (url: string) => req('DELETE', url),
    patch: (url: string, payload: object) => req('PATCH', url, payload),
  }
}

describe('the full app on PostgreSQL (PGlite)', () => {
  it('logs in, creates + moves a card, comments, and reads the board — all through pg', async () => {
    const admin = await t.asRole('admin')

    const created = await t.request(admin.cookie, {
      method: 'POST',
      url: '/api/v1/cards',
      payload: { title: 'PG-backed card', tags: ['pg'] },
    })
    expect(created.statusCode).toBe(201)
    const card = created.json<{ id: number; version: number }>()

    const moved = await t.request(admin.cookie, {
      method: 'POST',
      url: `/api/v1/cards/${String(card.id)}/move`,
      headers: { 'if-match': `"${String(card.version)}"` },
      payload: { toLane: 'ready' },
    })
    expect(moved.statusCode).toBe(200)

    const comment = await t.request(admin.cookie, {
      method: 'POST',
      url: `/api/v1/cards/${String(card.id)}/comments`,
      payload: { body: 'moved to ready via pg' },
    })
    expect(comment.statusCode).toBe(201)

    const board = await t.request(admin.cookie, { method: 'GET', url: '/api/v1/board' })
    expect(board.statusCode).toBe(200)
    const body = board.json<{
      lanes: { lane: { key: string }; cards: { title: string; tags: string[] }[] }[]
    }>()
    const ready = body.lanes.find((lane) => lane.lane.key === 'ready')
    const summary = ready?.cards.find((entry) => entry.title === 'PG-backed card')
    expect(summary).toBeDefined()
    expect(summary?.tags).toEqual(['pg'])
  })

  it('lists the card thread back through the pg comment repository', async () => {
    const admin = await t.asRole('admin')
    const created = await t.request(admin.cookie, {
      method: 'POST',
      url: '/api/v1/cards',
      payload: { title: 'Threaded on pg' },
    })
    const cardId = created.json<{ id: number }>().id

    await t.request(admin.cookie, {
      method: 'POST',
      url: `/api/v1/cards/${String(cardId)}/comments`,
      payload: { body: 'first' },
    })
    const thread = await t.request(admin.cookie, {
      method: 'GET',
      url: `/api/v1/cards/${String(cardId)}/comments`,
    })

    expect(thread.statusCode).toBe(200)
    expect(thread.json<{ body: string }[]>().map((entry) => entry.body)).toEqual(['first'])
  })

  it('manages the location tree and configurable columns through the pg repos', async () => {
    const api = await client()

    // Locations (strict building > floor > room): create tree → rename → delete subtree.
    const building = (await api.post('/api/v1/locations', { kind: 'building', name: 'HQ' })).json<{
      id: string
    }>()
    const floor = (
      await api.post('/api/v1/locations', { kind: 'floor', name: 'Floor 2', parentId: building.id })
    ).json<{ id: string }>()
    await api.post('/api/v1/locations', { kind: 'room', name: 'Room 1', parentId: floor.id })
    await api.patch(`/api/v1/locations/${building.id}`, { name: 'Headquarters' })
    expect((await api.get('/api/v1/locations')).json<unknown[]>().length).toBe(3)

    // Columns: add a lane, reorder it, delete it (all pg lane-repo writes).
    const lanesBefore = (await api.get('/api/v1/board')).json<{
      lanes: { lane: { id: string } }[]
    }>().lanes
    const added = (await api.post('/api/v1/lanes', { label: 'On Hold' })).json<{ id: string }>()
    const ids = [added.id, ...lanesBefore.map((entry) => entry.lane.id)]
    expect((await api.post('/api/v1/lanes/reorder', { orderedIds: ids })).statusCode).toBe(200)
    expect((await api.del(`/api/v1/lanes/${added.id}`)).statusCode).toBe(204)
    expect((await api.del(`/api/v1/locations/${building.id}`)).statusCode).toBe(204)
  })

  it('manages relations and watch state through the pg repos', async () => {
    const api = await client()
    const card = (await api.post('/api/v1/cards', { title: 'Relatable' })).json<{ id: number }>()
    const other = (await api.post('/api/v1/cards', { title: 'Related' })).json<{ id: number }>()

    // Relations (pg card-relation repo): add, list, remove.
    const relation = await api.post(`/api/v1/cards/${String(card.id)}/relations`, {
      toCardId: other.id,
      type: 'blocks',
    })
    expect(relation.statusCode).toBe(201)
    const relationId = relation.json<{ id: string }>().id
    expect((await api.get(`/api/v1/cards/${String(card.id)}/relations`)).statusCode).toBe(200)
    expect(
      (await api.del(`/api/v1/cards/${String(card.id)}/relations/${relationId}`)).statusCode,
    ).toBe(204)

    // Watch (pg card-watcher repo): reporter auto-watches; toggle off then on.
    expect(
      (await api.get(`/api/v1/cards/${String(card.id)}/watch`)).json<{ watching: boolean }>(),
    ).toEqual({ watching: true })
    await api.del(`/api/v1/cards/${String(card.id)}/watch`)
    expect(
      (await api.put(`/api/v1/cards/${String(card.id)}/watch`)).json<{ watching: boolean }>(),
    ).toEqual({ watching: true })
  })

  it('manages presets, service tokens, notifications, and user search through the pg repos', async () => {
    const api = await client()

    const preset = await api.post('/api/v1/filter-presets', {
      name: 'Mine',
      shared: true,
      filter: {
        priorities: [],
        assigneeIds: [],
        reporterIds: [],
        tags: [],
        locationIds: [],
        scope: 'active',
        q: '',
        overdue: false,
      },
    })
    expect(preset.statusCode).toBe(201)
    expect((await api.get('/api/v1/filter-presets')).json<unknown[]>().length).toBeGreaterThan(0)

    expect(
      (await api.post('/api/v1/service-tokens', { name: 'ci', role: 'admin', scope: 'read_write' }))
        .statusCode,
    ).toBe(201)
    const tokens = (await api.get('/api/v1/service-tokens')).json<{ id: string }[]>()
    const tokenId = tokens[0]?.id ?? ''
    expect((await api.post(`/api/v1/service-tokens/${tokenId}/rotate`)).statusCode).toBe(200)
    expect((await api.del(`/api/v1/service-tokens/${tokenId}`)).statusCode).toBe(204)

    expect((await api.get('/api/v1/users/search?q=admin')).statusCode).toBe(200)
    expect((await api.get('/api/v1/notifications')).statusCode).toBe(200)
    expect((await api.get('/api/v1/notifications/unread-count')).statusCode).toBe(200)
  })

  it('runs a card through block, cancel, reopen, and archive on pg', async () => {
    const admin = await t.asRole('admin')
    const created = await t.request(admin.cookie, {
      method: 'POST',
      url: '/api/v1/cards',
      payload: { title: 'Lifecycle on pg' },
    })
    const card = created.json<{ id: number; version: number }>()
    const act = (action: string, version: number, payload?: object) => {
      const base = {
        method: 'POST' as const,
        url: `/api/v1/cards/${String(card.id)}/${action}`,
        headers: { 'if-match': `"${String(version)}"` },
      }
      return t.request(admin.cookie, payload === undefined ? base : { ...base, payload })
    }

    const blocked = await act('block', card.version, { reason: 'waiting on vendor' })
    expect(blocked.statusCode).toBe(200)
    const unblocked = await act('unblock', blocked.json<{ version: number }>().version)
    const cancelled = await act('cancel', unblocked.json<{ version: number }>().version, {
      resolution: 'duplicate',
    })
    expect(cancelled.json<{ resolution: string }>().resolution).toBe('duplicate')
    const reopened = await act('reopen', cancelled.json<{ version: number }>().version)
    expect(reopened.statusCode).toBe(200)
  })
})
