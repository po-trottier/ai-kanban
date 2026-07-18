import {
  DEFAULT_POLICY_DOCUMENT,
  type BoardPolicy,
  type Card,
  type Location,
  type TransactionContext,
} from '@rivian-kanban/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { boardPolicies, cards } from '../schema.ts'
import {
  insertUser,
  makeCard,
  messageChain,
  newId,
  openTestDb,
  seedBaseline,
  type Baseline,
  type TestDb,
} from '../test/support.ts'

let db: TestDb
let base: Baseline

beforeAll(() => {
  db = openTestDb()
  base = seedBaseline(db.connection)
})

afterAll(() => {
  db.cleanup()
})

function run<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
  return db.uow.run(fn)
}

describe('SqliteUserRepository', () => {
  it('hydrates the User entity without ever exposing password_hash', async () => {
    const user = insertUser(db.connection, { displayName: 'Casey', role: 'supervisor' })

    const found = await run((tx) => tx.users.findById(user.id))

    expect(found).toEqual(user)
    expect(found === null || 'passwordHash' in found).toBe(false)
  })

  it('returns null for an unknown id', async () => {
    await expect(run((tx) => tx.users.findById(newId()))).resolves.toBeNull()
  })
})

describe('SqliteLaneRepository', () => {
  it('lists the seeded lanes in board order with labels and WIP limits', async () => {
    const listed = await run((tx) => tx.lanes.listByBoard(base.boardId))

    expect(listed.map((lane) => lane.key)).toEqual([
      'intake',
      'waiting_approval',
      'ready',
      'in_progress',
      'waiting_parts_vendor',
      'review',
      'done',
    ])
    expect(listed.map((lane) => lane.wipLimit)).toEqual([null, null, null, 5, 8, 5, null])
    expect(listed.at(4)?.label).toBe('Waiting on Parts / Vendor')
  })

  it('finds a lane by key and returns null for unknown keys/boards', async () => {
    const found = await run((tx) => tx.lanes.findByKey(base.boardId, 'review'))
    const wrongBoard = await run((tx) => tx.lanes.findByKey(newId(), 'review'))

    expect(found?.id).toBe(base.lanes.review.id)
    expect(wrongBoard).toBeNull()
  })

  it('updates label and WIP limit; unknown ids reject with NotFoundError', async () => {
    const lane = base.lanes.intake

    await run((tx) => tx.lanes.update({ ...lane, label: 'Triage', wipLimit: 4 }))
    const updated = await run((tx) => tx.lanes.findByKey(base.boardId, 'intake'))

    expect(updated).toMatchObject({ label: 'Triage', wipLimit: 4 })
    await expect(run((tx) => tx.lanes.update({ ...lane, id: newId() }))).rejects.toMatchObject({
      name: 'NotFoundError',
    })
  })
})

describe('SqliteLocationRepository', () => {
  /** Inserts a building → floor → room tree; returns the three ids. */
  async function insertTree(): Promise<{ buildingId: string; floorId: string; roomId: string }> {
    const buildingId = newId()
    const floorId = newId()
    const roomId = newId()
    const rows: Location[] = [
      { id: buildingId, parentId: null, kind: 'building', name: `B-${buildingId.slice(0, 6)}` },
      { id: floorId, parentId: buildingId, kind: 'floor', name: `F-${floorId.slice(0, 6)}` },
      { id: roomId, parentId: floorId, kind: 'room', name: `R-${roomId.slice(0, 6)}` },
    ]
    await run(async (tx) => {
      for (const row of rows) await tx.locations.insert(row)
    })
    return { buildingId, floorId, roomId }
  }

  it('finds an inserted location and returns null for unknown ids', async () => {
    const { roomId } = await insertTree()

    const found = await run((tx) => tx.locations.findById(roomId))
    const missing = await run((tx) => tx.locations.findById(newId()))

    expect(found?.kind).toBe('room')
    expect(found?.parentId).not.toBeNull()
    expect(missing).toBeNull()
  })

  it('deleting a building recursively removes its floors and rooms in one transaction', async () => {
    const { buildingId, floorId, roomId } = await insertTree()

    await run((tx) => tx.locations.delete(buildingId))

    const remaining = await run(async (tx) => ({
      building: await tx.locations.findById(buildingId),
      floor: await tx.locations.findById(floorId),
      room: await tx.locations.findById(roomId),
    }))
    expect(remaining).toEqual({ building: null, floor: null, room: null })
  })

  it('nulls location_id on every card referencing any location in the deleted subtree', async () => {
    const { buildingId, floorId, roomId } = await insertTree()
    const reporterId = insertUser(db.connection).id
    const located = makeCard({
      boardId: base.boardId,
      laneId: base.lanes.review.id,
      reporterId,
      position: 'a1',
      locationId: roomId,
    })
    const untouched = makeCard({
      boardId: base.boardId,
      laneId: base.lanes.review.id,
      reporterId,
      position: 'a2',
      locationId: null,
    })
    await run(async (tx) => {
      await tx.cards.insert(located)
      await tx.cards.insert(untouched)
    })

    await run((tx) => tx.locations.delete(buildingId))

    const locatedRow = db.connection.db.select().from(cards).where(eq(cards.id, located.id)).get()
    const untouchedRow = db.connection.db
      .select()
      .from(cards)
      .where(eq(cards.id, untouched.id))
      .get()
    // Location optional: the card survives, just loses the reference.
    expect(locatedRow?.locationId).toBeNull()
    expect(untouchedRow?.locationId).toBeNull()
    // Both cards still exist.
    expect(locatedRow?.id).toBe(located.id)
    expect(untouchedRow?.id).toBe(untouched.id)
    // The whole subtree is gone.
    expect(await run((tx) => tx.locations.findById(floorId))).toBeNull()
  })

  it('deleting a leaf room removes only it and leaves ancestors intact', async () => {
    const { buildingId, floorId, roomId } = await insertTree()

    await run((tx) => tx.locations.delete(roomId))

    const remaining = await run(async (tx) => ({
      building: await tx.locations.findById(buildingId),
      floor: await tx.locations.findById(floorId),
      room: await tx.locations.findById(roomId),
    }))
    expect(remaining.building?.id).toBe(buildingId)
    expect(remaining.floor?.id).toBe(floorId)
    expect(remaining.room).toBeNull()
  })

  it('rejects deleting a missing id with NotFoundError (no children to remove)', async () => {
    await expect(run((tx) => tx.locations.delete(newId()))).rejects.toMatchObject({
      name: 'NotFoundError',
    })
  })
})

describe('SqliteTagRepository', () => {
  let card: Card

  beforeAll(async () => {
    card = makeCard({
      boardId: base.boardId,
      laneId: base.lanes.intake.id,
      reporterId: insertUser(db.connection).id,
    })
    await run((tx) => tx.cards.insert(card))
  })

  it('finds tags case-insensitively while preserving stored case', async () => {
    await run((tx) => tx.tags.insert({ id: newId(), name: 'HVAC' }))

    const hit = await run((tx) => tx.tags.findByNameCi('hvac'))
    const miss = await run((tx) => tx.tags.findByNameCi('plumbing'))

    expect(hit?.name).toBe('HVAC')
    expect(miss).toBeNull()
  })

  it('enforces UNIQUE COLLATE NOCASE on tag names', async () => {
    await run((tx) => tx.tags.insert({ id: newId(), name: 'Paint' }))

    const error: unknown = await run((tx) => tx.tags.insert({ id: newId(), name: 'pAiNt' })).then(
      () => null,
      (reason: unknown) => reason,
    )

    expect(messageChain(error)).toContain('UNIQUE constraint failed: tags.name')
  })

  it('setCardTags is full-replacement and listByCard returns stored names', async () => {
    const alpha = { id: newId(), name: 'alpha' }
    const beta = { id: newId(), name: 'Beta' }
    const gamma = { id: newId(), name: 'gamma' }
    await run(async (tx) => {
      await tx.tags.insert(alpha)
      await tx.tags.insert(beta)
      await tx.tags.insert(gamma)
      await tx.tags.setCardTags(card.id, [alpha.id, gamma.id])
    })

    const first = await run((tx) => tx.tags.listByCard(card.id))
    await run((tx) => tx.tags.setCardTags(card.id, [beta.id]))
    const second = await run((tx) => tx.tags.listByCard(card.id))
    await run((tx) => tx.tags.setCardTags(card.id, []))
    const third = await run((tx) => tx.tags.listByCard(card.id))

    expect(first.map((tag) => tag.name)).toEqual(['alpha', 'gamma'])
    expect(second.map((tag) => tag.name)).toEqual(['Beta'])
    expect(third).toEqual([])
  })

  it('rejects card_tags rows pointing at an unknown tag (FK enforced)', async () => {
    const error: unknown = await run((tx) => tx.tags.setCardTags(card.id, [newId()])).then(
      () => null,
      (reason: unknown) => reason,
    )

    expect(messageChain(error)).toContain('FOREIGN KEY constraint failed')
  })
})

describe('SqlitePolicyRepository', () => {
  it('getActive returns the newest version for the board (append-only history)', async () => {
    const adminId = insertUser(db.connection, { role: 'admin' }).id
    // Anchor to the wall clock: the structural seed writes its policy at
    // `new Date()`, so both versions must be strictly newer than "now" to be
    // the active one — hardcoded dates rot the moment real time passes them.
    const asOf = Date.now()
    const older: BoardPolicy = {
      id: newId(),
      boardId: base.boardId,
      config: { ...DEFAULT_POLICY_DOCUMENT, transitionEnforcement: true },
      createdBy: adminId,
      createdAt: new Date(asOf + 1000).toISOString(),
    }
    const newer: BoardPolicy = {
      id: newId(),
      boardId: base.boardId,
      config: { ...DEFAULT_POLICY_DOCUMENT, transitionEnforcement: false },
      createdBy: adminId,
      createdAt: new Date(asOf + 2000).toISOString(),
    }
    await run((tx) => tx.policies.insert(older))
    await run((tx) => tx.policies.insert(newer))

    const active = await run((tx) => tx.policies.getActive(base.boardId))
    const versionCount = db.connection.db
      .select()
      .from(boardPolicies)
      .where(eq(boardPolicies.boardId, base.boardId))
      .all().length

    expect(active?.id).toBe(newer.id)
    expect(versionCount).toBe(3) // structural seed + the two above — nothing overwritten
  })

  it('getActive returns null for an unseeded board', async () => {
    await expect(run((tx) => tx.policies.getActive(newId()))).resolves.toBeNull()
  })

  it('rejects a policy version created by an unknown user (FK enforced)', async () => {
    const rogue: BoardPolicy = {
      id: newId(),
      boardId: base.boardId,
      config: DEFAULT_POLICY_DOCUMENT,
      createdBy: newId(),
      createdAt: '2026-07-19T00:00:00.000Z',
    }

    const error: unknown = await run((tx) => tx.policies.insert(rogue)).then(
      () => null,
      (reason: unknown) => reason,
    )

    expect(messageChain(error)).toContain('FOREIGN KEY constraint failed')
  })

  it('fails loudly on a corrupt stored policy document instead of evaluating it', async () => {
    const boardId = base.boardId
    db.connection.db
      .insert(boardPolicies)
      .values({
        id: newId(),
        boardId,
        config: { transitionEnforcement: 'yes-please' },
        createdBy: base.systemUserId,
        // Newest version wins, so make it strictly after the seed's `new Date()`.
        createdAt: new Date(Date.now() + 3_600_000).toISOString(),
      })
      .run()

    const error: unknown = await run((tx) => tx.policies.getActive(boardId)).then(
      () => null,
      (reason: unknown) => reason,
    )

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).name).toBe('ZodError')
  })
})
