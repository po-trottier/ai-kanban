import { type Card, type CardRelation, type TransactionContext } from '@rivian-kanban/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  insertUser,
  makeCard,
  newId,
  openTestDb,
  seedBaseline,
  T0,
  type Baseline,
  type TestDb,
} from '../test/support.ts'

/**
 * The card-relations DB surface (docs/architecture/card-relations.md): directed
 * rows, `listByCard` spanning both ends, `exists` (direction + type sensitive),
 * and the composite UNIQUE backstop. Real SQLite, real migrations.
 */

let db: TestDb
let base: Baseline
let alice: string

beforeAll(() => {
  db = openTestDb()
  base = seedBaseline(db.connection)
  alice = insertUser(db.connection).id
})

afterAll(() => {
  db.cleanup()
})

function run<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
  return db.uow.run(fn)
}

function card(overrides: Partial<Card> = {}): Card {
  return makeCard({
    boardId: base.boardId,
    laneId: base.lanes.intake.id,
    reporterId: alice,
    position: newId(),
    ...overrides,
  })
}

function relation(
  overrides: Partial<CardRelation> & Pick<CardRelation, 'fromCardId' | 'toCardId'>,
): CardRelation {
  return { id: newId(), type: 'blocks', createdAt: T0, ...overrides }
}

describe('CardRelationRepository', () => {
  it('lists relations touching a card on either end, newest-first', async () => {
    // Arrange — subject blocks A (subject is `from`); B blocks subject (subject is `to`).
    const subject = card()
    const a = card()
    const b = card()
    await run(async (tx) => {
      for (const c of [subject, a, b]) await tx.cards.insert(c)
    })
    const older = relation({
      fromCardId: subject.id,
      toCardId: a.id,
      createdAt: '2026-07-01T00:00:00.000Z',
    })
    const newer = relation({
      fromCardId: b.id,
      toCardId: subject.id,
      createdAt: '2026-07-10T00:00:00.000Z',
    })
    await run(async (tx) => {
      for (const r of [older, newer]) await tx.cardRelations.insert(r)
    })

    // Act
    const list = await run((tx) => tx.cardRelations.listByCard(subject.id))

    // Assert — both ends, newest-first.
    expect(list.map((r) => r.id)).toEqual([newer.id, older.id])
  })

  it('reports whether an identical DIRECTED relation exists (direction + type matter)', async () => {
    // Arrange
    const x = card()
    const y = card()
    await run(async (tx) => {
      for (const c of [x, y]) await tx.cards.insert(c)
    })
    await run((tx) =>
      tx.cardRelations.insert(relation({ fromCardId: x.id, toCardId: y.id, type: 'duplicates' })),
    )

    // Act
    const exact = await run((tx) => tx.cardRelations.exists(x.id, y.id, 'duplicates'))
    const otherType = await run((tx) => tx.cardRelations.exists(x.id, y.id, 'blocks'))
    const reversed = await run((tx) => tx.cardRelations.exists(y.id, x.id, 'duplicates'))

    // Assert
    expect(exact).toBe(true)
    expect(otherType).toBe(false)
    expect(reversed).toBe(false)
  })

  it('finds and hard-deletes a relation by id', async () => {
    // Arrange
    const p = card()
    const q = card()
    await run(async (tx) => {
      for (const c of [p, q]) await tx.cards.insert(c)
    })
    const r = relation({ fromCardId: p.id, toCardId: q.id })
    await run((tx) => tx.cardRelations.insert(r))

    // Act
    const found = await run((tx) => tx.cardRelations.findById(r.id))
    await run((tx) => tx.cardRelations.delete(r.id))
    const afterDelete = await run((tx) => tx.cardRelations.findById(r.id))

    // Assert
    expect(found?.id).toBe(r.id)
    expect(afterDelete).toBeNull()
  })

  it('rejects a duplicate directed relation at the composite UNIQUE backstop', async () => {
    // Arrange
    const s = card()
    const t = card()
    await run(async (tx) => {
      for (const c of [s, t]) await tx.cards.insert(c)
    })
    await run((tx) =>
      tx.cardRelations.insert(relation({ fromCardId: s.id, toCardId: t.id, type: 'relates_to' })),
    )

    // Act — the same (from, to, type) again.
    const act = run((tx) =>
      tx.cardRelations.insert(relation({ fromCardId: s.id, toCardId: t.id, type: 'relates_to' })),
    )

    // Assert — UNIQUE(from_card_id, to_card_id, type) rejects it.
    await expect(act).rejects.toThrow()
  })
})
