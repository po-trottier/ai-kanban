import {
  DEFAULT_POLICY_DOCUMENT,
  DEFAULT_THEME,
  DEFAULT_TIMEZONE,
  Uuidv7IdGenerator,
} from '@rivian-kanban/core'
import { and, eq } from 'drizzle-orm'
import { boardPolicies, boards, lanes, users } from '../schema.pg.ts'
import {
  LANE_SEEDS,
  PLACEHOLDER_PASSWORD_HASH,
  SYSTEM_USER_EMAIL,
  type StructuralSeedResult,
} from '../seed.ts'
import { type PgDb } from './database.ts'

const ids = new Uuidv7IdGenerator()

/**
 * The Postgres structural seed (ADR-020): the pg analogue of
 * `seed.ts` `structuralSeed` — board, `system` user, the 7 lanes (seeded WIP
 * limits), and the default permissive policy document. Idempotent by natural
 * keys; safe to run on every boot. Inserts NO locations.
 */
export async function structuralSeedPg(db: PgDb): Promise<StructuralSeedResult> {
  return db.transaction(async (tx) => {
    const now = new Date().toISOString()

    let board = (await tx.select().from(boards).limit(1))[0]
    if (board === undefined) {
      board = { id: ids.newId(), name: 'Facilities', createdAt: now }
      await tx.insert(boards).values(board)
    }

    let system = (
      await tx.select().from(users).where(eq(users.email, SYSTEM_USER_EMAIL)).limit(1)
    )[0]
    if (system === undefined) {
      system = {
        id: ids.newId(),
        email: SYSTEM_USER_EMAIL,
        displayName: 'Automation',
        role: 'admin',
        passwordHash: PLACEHOLDER_PASSWORD_HASH,
        mustChangePassword: false,
        slackUserId: null,
        isActive: true,
        timezone: DEFAULT_TIMEZONE,
        theme: DEFAULT_THEME,
        createdAt: now,
      }
      await tx.insert(users).values(system)
    }

    for (const [index, seed] of LANE_SEEDS.entries()) {
      const existing = (
        await tx
          .select()
          .from(lanes)
          .where(and(eq(lanes.boardId, board.id), eq(lanes.key, seed.key)))
          .limit(1)
      )[0]
      if (existing === undefined) {
        await tx.insert(lanes).values({
          id: ids.newId(),
          boardId: board.id,
          key: seed.key,
          label: seed.label,
          position: index,
          wipLimit: seed.wipLimit,
        })
      }
    }

    const policy = (
      await tx
        .select({ id: boardPolicies.id })
        .from(boardPolicies)
        .where(eq(boardPolicies.boardId, board.id))
        .limit(1)
    )[0]
    if (policy === undefined) {
      await tx.insert(boardPolicies).values({
        id: ids.newId(),
        boardId: board.id,
        config: DEFAULT_POLICY_DOCUMENT,
        createdBy: system.id,
        createdAt: now,
      })
    }

    return { boardId: board.id, systemUserId: system.id }
  })
}
