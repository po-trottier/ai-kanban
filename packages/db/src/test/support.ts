import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  Uuidv7IdGenerator,
  type Card,
  type Comment,
  type Lane,
  type LaneKey,
  type User,
} from '@rivian-kanban/core'
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
  lanes: Record<LaneKey, Lane>
}

/** Structural seed + lane lookup — the FK-valid floor repository tests build on. */
export function seedBaseline(connection: DbConnection): Baseline {
  const { boardId, systemUserId } = structuralSeed(connection.db)
  const laneRows = connection.db.select().from(lanes).where(eq(lanes.boardId, boardId)).all()
  return {
    boardId,
    systemUserId,
    lanes: Object.fromEntries(laneRows.map((lane) => [lane.key, lane])) as Record<LaneKey, Lane>,
  }
}

const ids = new Uuidv7IdGenerator()

export function newId(): string {
  return ids.newId()
}

export const T0 = '2026-07-16T12:00:00.000Z'

function makeUser(overrides: Partial<User> = {}): User {
  const id = overrides.id ?? newId()
  return {
    id,
    email: `${id}@example.com`,
    displayName: 'Test User',
    role: 'technician',
    mustChangePassword: false,
    slackUserId: null,
    isActive: true,
    createdAt: T0,
    ...overrides,
  }
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
  return {
    id: newId(),
    position: 'a0',
    title: 'Test card',
    description: '',
    priority: 'P2',
    estimateMinutes: null,
    assigneeId: null,
    locationId: null,
    origin: 'manual',
    resolution: null,
    blocked: false,
    blockedReason: null,
    blockedAt: null,
    waitingReason: null,
    expectedResumeAt: null,
    resumeAlertedAt: null,
    slackChannelId: null,
    slackThreadTs: null,
    slackPermalink: null,
    version: 1,
    createdAt: T0,
    updatedAt: T0,
    archivedAt: null,
    ...overrides,
  }
}

export function makeComment(
  overrides: Partial<Comment> & Pick<Comment, 'cardId' | 'authorId'>,
): Comment {
  return {
    id: newId(),
    parentCommentId: null,
    body: 'A comment',
    createdAt: T0,
    updatedAt: T0,
    deletedAt: null,
    ...overrides,
  }
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
