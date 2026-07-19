import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  Uuidv7IdGenerator,
  type Card,
  type Comment,
  type Lane,
  type SeedLaneKey,
  type User,
} from '@rivian-kanban/core'
import { cardWith, commentWith, userWith } from '@rivian-kanban/core/testing'
import { eq } from 'drizzle-orm'
import { openDatabase, type DbConnection } from '../connection.ts'
import { lanes, users } from '../schema.ts'
import { structuralSeed, PLACEHOLDER_PASSWORD_HASH } from '../seed.ts'
import { SqliteUnitOfWork } from '../unit-of-work.ts'

/**
 * Integration-test support: every test file owns a real temp SQLite database
 * with real migrations applied, deleted in afterAll (docs/dev/testing.md).
 */

export interface TestDb {
  connection: DbConnection
  uow: SqliteUnitOfWork
  cleanup(): void
}

export function openTestDb(): TestDb {
  const dir = mkdtempSync(join(tmpdir(), 'rivian-kanban-db-'))
  const connection = openDatabase(join(dir, 'test.sqlite'))
  return {
    connection,
    uow: new SqliteUnitOfWork(connection),
    cleanup: () => {
      connection.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

export interface Baseline {
  boardId: string
  systemUserId: string
  lanes: Record<SeedLaneKey, Lane>
}

/** Structural seed + lane lookup — the FK-valid floor repository tests build on. */
export function seedBaseline(connection: DbConnection): Baseline {
  const { boardId, systemUserId } = structuralSeed(connection.db)
  const laneRows = connection.db.select().from(lanes).where(eq(lanes.boardId, boardId)).all()
  return {
    boardId,
    systemUserId,
    lanes: Object.fromEntries(laneRows.map((lane) => [lane.key, lane])) as Record<
      SeedLaneKey,
      Lane
    >,
  }
}

const ids = new Uuidv7IdGenerator()

export function newId(): string {
  return ids.newId()
}

/** Monotonic integer card id for fixtures — the card id IS its ticket number. */
let nextCardId = 0
function newCardId(): number {
  nextCardId += 1
  return nextCardId
}

export const T0 = '2026-07-16T12:00:00.000Z'

function makeUser(overrides: Partial<User> = {}): User {
  const id = overrides.id ?? newId()
  return userWith({
    id,
    email: `${id}@example.com`,
    displayName: 'Test User',
    role: 'user',
    createdAt: T0,
    ...overrides,
  })
}

/** Inserts the user row (with a placeholder hash) and returns the entity. */
export function insertUser(connection: DbConnection, overrides: Partial<User> = {}): User {
  const user = makeUser(overrides)
  connection.db
    .insert(users)
    .values({ ...user, passwordHash: PLACEHOLDER_PASSWORD_HASH })
    .run()
  return user
}

export function makeCard(
  overrides: Partial<Card> & Pick<Card, 'boardId' | 'laneId' | 'reporterId'>,
): Card {
  return cardWith({
    id: newCardId(),
    position: 'a0',
    title: 'Test card',
    createdAt: T0,
    ...overrides,
  })
}

export function makeComment(
  overrides: Partial<Comment> & Pick<Comment, 'cardId' | 'authorId'>,
): Comment {
  return commentWith({ id: newId(), createdAt: T0, ...overrides })
}

/** Flattens an error's `cause` chain into one searchable string. */
export function messageChain(error: unknown): string {
  const messages: string[] = []
  let current: unknown = error
  while (current instanceof Error) {
    messages.push(current.message)
    current = current.cause
  }
  return messages.join(' | ')
}
