import {
  ConflictError,
  NotFoundError,
  type Group,
  type TransactionContext,
} from '@rivian-kanban/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { insertUser, newId, openTestDb, seedBaseline, T0, type TestDb } from '../test/support.ts'

/**
 * Global user groups (docs/superpowers/plans/2026-09-15-multiple-boards.md):
 * GroupRepository CRUD, stored memberships, the case-insensitive duplicate
 * name backstop (`groups_name_ci_unique`), and a board's `allowedGroupIds`
 * roundtrip. Real SQLite, real migrations.
 */

let db: TestDb
let alice: string
let bob: string

beforeAll(() => {
  db = openTestDb()
  // The structural seed (board/lanes/policy) — this file only needs FK-valid
  // users, not the seeded board's id, so the result is discarded.
  seedBaseline(db.connection)
  alice = insertUser(db.connection).id
  bob = insertUser(db.connection).id
})

afterAll(() => {
  db.cleanup()
})

function run<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
  return db.uow.run(fn)
}

function group(overrides: Partial<Group> = {}): Group {
  return { id: newId(), name: `Group-${newId()}`, userIds: [], createdAt: T0, ...overrides }
}

describe('SqliteGroupRepository', () => {
  it('CRUD: insert, findById, list, update (membership persists), remove', async () => {
    const g = group({ name: 'On-call Technicians', userIds: [alice, bob] })
    await run((tx) => tx.groups.insert(g))

    const found = await run((tx) => tx.groups.findById(g.id))
    const listed = await run((tx) => tx.groups.list())

    expect(found).toEqual(g)
    expect(found?.userIds).toEqual([alice, bob])
    expect(listed.map((row) => row.id)).toContain(g.id)

    await run((tx) => tx.groups.update({ ...g, name: 'On-call (renamed)', userIds: [bob] }))
    const updated = await run((tx) => tx.groups.findById(g.id))
    expect(updated).toMatchObject({ name: 'On-call (renamed)', userIds: [bob] })

    await run((tx) => tx.groups.remove(g.id))
    expect(await run((tx) => tx.groups.findById(g.id))).toBeNull()
    expect((await run((tx) => tx.groups.list())).map((row) => row.id)).not.toContain(g.id)
  })

  it('update on an unknown id rejects with NotFoundError', async () => {
    await expect(run((tx) => tx.groups.update(group()))).rejects.toBeInstanceOf(NotFoundError)
  })

  it('remove on an unknown id is a no-op (repo does not enforce assignment checks)', async () => {
    await expect(run((tx) => tx.groups.remove(newId()))).resolves.toBeUndefined()
  })

  it('rejects a case-insensitive duplicate name with ConflictError (race backstop)', async () => {
    const original = group({ name: 'Facilities Crew' })
    await run((tx) => tx.groups.insert(original))

    await expect(
      run((tx) => tx.groups.insert(group({ name: 'facilities crew' }))),
    ).rejects.toBeInstanceOf(ConflictError)
    await expect(
      run((tx) => tx.groups.insert(group({ name: 'FACILITIES CREW' }))),
    ).rejects.toBeInstanceOf(ConflictError)

    // Renaming an unrelated group into a collision is rejected the same way.
    const other = group({ name: 'Warehouse Crew' })
    await run((tx) => tx.groups.insert(other))
    await expect(
      run((tx) => tx.groups.update({ ...other, name: 'facilities crew' })),
    ).rejects.toBeInstanceOf(ConflictError)
  })
})

describe('Board.allowedGroupIds roundtrip', () => {
  it('persists and round-trips a list of group ids on the board row', async () => {
    const g1 = group({ name: `RT-1-${newId()}` })
    const g2 = group({ name: `RT-2-${newId()}` })
    await run(async (tx) => {
      await tx.groups.insert(g1)
      await tx.groups.insert(g2)
    })

    const board = {
      id: newId(),
      name: 'Restricted Board',
      createdAt: T0,
      isDefault: false,
      archivedAt: null,
      accessMode: 'restricted' as const,
      allowedRoleKeys: [],
      allowedUserIds: [],
      allowedGroupIds: [g1.id, g2.id],
    }
    await run((tx) => tx.boards.insert(board))

    const found = await run((tx) => tx.boards.findById(board.id))
    expect(found?.allowedGroupIds).toEqual([g1.id, g2.id])

    // Update replaces the set (a group removed from the allowlist).
    await run((tx) => tx.boards.update({ ...board, allowedGroupIds: [g2.id] }))
    const updated = await run((tx) => tx.boards.findById(board.id))
    expect(updated?.allowedGroupIds).toEqual([g2.id])
  })
})
