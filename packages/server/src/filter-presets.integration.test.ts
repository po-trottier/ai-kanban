import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestApp, type TestApp } from './test/support.ts'

/**
 * The board-filter REST surface (docs/architecture/board-filters.md): the
 * filtered `POST /board/query` read and the per-user filter-preset CRUD. Real
 * Fastify app, real SQLite, real session auth — a user only ever sees/edits
 * their own presets.
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

interface Snapshot {
  lanes: { lane: { key: string }; cards: { id: number; priority: string }[] }[]
}

function allCards(snapshot: Snapshot): { id: number; priority: string }[] {
  return snapshot.lanes.flatMap((lane) => lane.cards)
}

async function createCard(payload: Record<string, unknown>): Promise<{ id: number }> {
  const response = await t.request(cookie, { method: 'POST', url: '/api/v1/cards', payload })
  if (response.statusCode !== 201) throw new Error(`create failed: ${response.body}`)
  return response.json<{ id: number }>()
}

describe('POST /board/query', () => {
  it('the empty filter returns the full board grouped by lane', async () => {
    // Arrange
    await createCard({ title: 'Empty filter card', priority: 'P0' })

    // Act — {} is the full board (same shape as GET /board).
    const response = await t.request(cookie, {
      method: 'POST',
      url: '/api/v1/board/query',
      payload: {},
    })

    // Assert
    expect(response.statusCode).toBe(200)
    const snapshot = response.json<Snapshot>()
    expect(snapshot.lanes.map((lane) => lane.lane.key)).toContain('intake')
    expect(allCards(snapshot).length).toBeGreaterThan(0)
  })

  it('narrows by a priority multi-select at the API layer', async () => {
    // Arrange — one P0 and one P2 (both land in intake).
    const p0 = await createCard({ title: 'Priority P0', priority: 'P0' })
    await createCard({ title: 'Priority P2', priority: 'P2' })

    // Act
    const response = await t.request(cookie, {
      method: 'POST',
      url: '/api/v1/board/query',
      payload: { priorities: ['P0'] },
    })

    // Assert — every returned card is P0, and our P0 card is among them.
    const cards = allCards(response.json<Snapshot>())
    expect(cards.every((card) => card.priority === 'P0')).toBe(true)
    expect(cards.map((card) => card.id)).toContain(p0.id)
  })

  it('rejects an unknown facet (strict schema)', async () => {
    // Act
    const response = await t.request(cookie, {
      method: 'POST',
      url: '/api/v1/board/query',
      payload: { nope: true },
    })

    // Assert
    expect(response.statusCode).toBe(400)
  })
})

describe('filter-preset CRUD (per-user)', () => {
  it("creates, lists, renames, and deletes the caller's own presets", async () => {
    // Create
    const created = await t.request(cookie, {
      method: 'POST',
      url: '/api/v1/filter-presets',
      payload: { name: 'My overdue', filter: { overdue: true } },
    })
    expect(created.statusCode).toBe(201)
    const preset = created.json<{ id: string; ownerId: string; filter: { overdue: boolean } }>()
    expect(preset.filter.overdue).toBe(true)

    // List
    const listed = await t.request(cookie, { method: 'GET', url: '/api/v1/filter-presets' })
    expect(listed.json<{ id: string }[]>().some((p) => p.id === preset.id)).toBe(true)

    // Rename
    const renamed = await t.request(cookie, {
      method: 'PATCH',
      url: `/api/v1/filter-presets/${preset.id}`,
      payload: { name: 'Renamed' },
    })
    expect(renamed.statusCode).toBe(200)
    expect(renamed.json<{ name: string }>().name).toBe('Renamed')

    // Delete
    const deleted = await t.request(cookie, {
      method: 'DELETE',
      url: `/api/v1/filter-presets/${preset.id}`,
    })
    expect(deleted.statusCode).toBe(204)
  })

  it('replaces the entire saved filter on PATCH (a preset sets the COMPLETE state)', async () => {
    // Arrange — a preset that carries `overdue: true`.
    const created = await t.request(cookie, {
      method: 'POST',
      url: '/api/v1/filter-presets',
      payload: { name: 'Replace me', filter: { overdue: true } },
    })
    const preset = created.json<{ id: string }>()

    // Act — replace the filter (and rename) in one PATCH.
    const replaced = await t.request(cookie, {
      method: 'PATCH',
      url: `/api/v1/filter-presets/${preset.id}`,
      payload: { name: 'Final', filter: { q: 'hvac', priorities: ['P0'] } },
    })

    // Assert — the whole filter was replaced; the earlier `overdue: true` is gone.
    expect(replaced.statusCode).toBe(200)
    expect(replaced.json<{ filter: { q: string; overdue: boolean } }>().filter).toMatchObject({
      q: 'hvac',
      overdue: false,
    })
  })

  it('isolates presets per user — another user cannot see or edit them (404)', async () => {
    // Arrange — owner creates a preset (private by default).
    const created = await t.request(cookie, {
      method: 'POST',
      url: '/api/v1/filter-presets',
      payload: { name: 'Private', filter: {} },
    })
    const preset = created.json<{ id: string; shared: boolean }>()
    // Default is per-user private.
    expect(preset.shared).toBe(false)
    const other = await t.asRole('user')

    // Act — a different user lists, edits, and deletes it.
    const otherList = await t.request(other.cookie, {
      method: 'GET',
      url: '/api/v1/filter-presets',
    })
    const otherEdit = await t.request(other.cookie, {
      method: 'PATCH',
      url: `/api/v1/filter-presets/${preset.id}`,
      payload: { name: 'Hijacked' },
    })
    const otherDelete = await t.request(other.cookie, {
      method: 'DELETE',
      url: `/api/v1/filter-presets/${preset.id}`,
    })

    // Assert — invisible in the other user's list; edit/delete are 404.
    expect(otherList.json<{ id: string }[]>().some((p) => p.id === preset.id)).toBe(false)
    expect(otherEdit.statusCode).toBe(404)
    expect(otherDelete.statusCode).toBe(404)
  })

  it('a SHARED preset is visible to everyone but editable only by its owner', async () => {
    // Arrange — the owner shares a preset with the team.
    const created = await t.request(cookie, {
      method: 'POST',
      url: '/api/v1/filter-presets',
      payload: { name: 'Team view', filter: { overdue: true }, shared: true },
    })
    expect(created.json<{ shared: boolean }>().shared).toBe(true)
    const preset = created.json<{ id: string }>()
    const other = await t.asRole('user')

    // Act — a different user lists (sees it), then tries to edit and delete it.
    const otherList = await t.request(other.cookie, {
      method: 'GET',
      url: '/api/v1/filter-presets',
    })
    const otherEdit = await t.request(other.cookie, {
      method: 'PATCH',
      url: `/api/v1/filter-presets/${preset.id}`,
      payload: { name: 'Hijacked' },
    })
    const otherDelete = await t.request(other.cookie, {
      method: 'DELETE',
      url: `/api/v1/filter-presets/${preset.id}`,
    })

    // Assert — a shared preset shows in the other user's list, but mutating it
    // is owner-only (both 404, exactly like an unknown id).
    expect(otherList.json<{ id: string }[]>().some((p) => p.id === preset.id)).toBe(true)
    expect(otherEdit.statusCode).toBe(404)
    expect(otherDelete.statusCode).toBe(404)
  })

  it('the owner can (un)share an existing preset via PATCH', async () => {
    // Arrange — a private preset.
    const created = await t.request(cookie, {
      method: 'POST',
      url: '/api/v1/filter-presets',
      payload: { name: 'Toggle share', filter: {} },
    })
    const preset = created.json<{ id: string }>()

    // Act — share it, then un-share it.
    const shared = await t.request(cookie, {
      method: 'PATCH',
      url: `/api/v1/filter-presets/${preset.id}`,
      payload: { shared: true },
    })
    const unshared = await t.request(cookie, {
      method: 'PATCH',
      url: `/api/v1/filter-presets/${preset.id}`,
      payload: { shared: false },
    })

    // Assert — the flag flips both ways.
    expect(shared.json<{ shared: boolean }>().shared).toBe(true)
    expect(unshared.json<{ shared: boolean }>().shared).toBe(false)
  })
})
