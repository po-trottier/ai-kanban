import {
  DEFAULT_POLICY_DOCUMENT,
  type BoardPolicy,
  type Card,
  type TransactionContext,
} from '@rivian-kanban/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { boardPolicies, locations } from '../schema.ts'
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
  it('finds a seeded location and returns null for unknown ids', async () => {
    const room = db.connection.db.select().from(locations).where(eq(locations.kind, 'room')).all()

    const found = await run((tx) => tx.locations.findById(room.at(0)?.id ?? ''))
    const missing = await run((tx) => tx.locations.findById(newId()))

    expect(found?.kind).toBe('room')
    expect(found?.parentId).not.toBeNull()
    expect(missing).toBeNull()
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
    const older: BoardPolicy = {
      id: newId(),
      boardId: base.boardId,
      config: { ...DEFAULT_POLICY_DOCUMENT, transitionEnforcement: true },
      createdBy: adminId,
      createdAt: '2026-07-17T00:00:00.000Z',
    }
    const newer: BoardPolicy = {
      id: newId(),
      boardId: base.boardId,
      config: { ...DEFAULT_POLICY_DOCUMENT, transitionEnforcement: false },
      createdBy: adminId,
      createdAt: '2026-07-18T00:00:00.000Z',
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
        createdAt: '2027-01-01T00:00:00.000Z',
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
