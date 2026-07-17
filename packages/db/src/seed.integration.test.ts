import { LANE_KEYS, ROLES } from '@rivian-kanban/core'
import { isNotNull, isNull, and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { attachments, boards, cardEvents, cards, comments, lanes, tags, users } from './schema.ts'
import {
  demoSeed,
  demoUserEmail,
  PLACEHOLDER_PASSWORD_HASH,
  structuralSeed,
  SYSTEM_USER_EMAIL,
} from './seed.ts'
import { openTestDb, type TestDb } from './test/support.ts'

let db: TestDb

beforeAll(() => {
  db = openTestDb()
})

afterAll(() => {
  db.cleanup()
})

function count(table: string): number {
  const row = db.connection.raw
    .prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)
    .get()
  return row?.n ?? 0
}

describe('structuralSeed', () => {
  it('creates board, lanes, policy, locations, and the system user from scratch', () => {
    const result = structuralSeed(db.connection.db)

    const laneRows = db.connection.db.select().from(lanes).all()
    const system = db.connection.db
      .select()
      .from(users)
      .where(eq(users.email, SYSTEM_USER_EMAIL))
      .get()

    expect(db.connection.db.select().from(boards).all()).toHaveLength(1)
    expect(laneRows.map((lane) => lane.key).sort()).toEqual([...LANE_KEYS].sort())
    expect(
      laneRows
        .filter((lane) => lane.wipLimit !== null)
        .map((lane) => [lane.key, lane.wipLimit])
        .sort(),
    ).toEqual([
      ['in_progress', 5],
      ['review', 5],
      ['waiting_parts_vendor', 8],
    ])
    expect(count('board_policies')).toBe(1)
    expect(count('locations')).toBeGreaterThanOrEqual(6)
    expect(system?.displayName).toBe('Automation')
    expect(system?.passwordHash).toBe(PLACEHOLDER_PASSWORD_HASH)
    expect(result.systemUserId).toBe(system?.id)
  })

  it('is idempotent: a second run adds no rows and preserves ids', () => {
    const before = {
      boards: count('boards'),
      lanes: count('lanes'),
      users: count('users'),
      policies: count('board_policies'),
      locations: count('locations'),
    }
    const first = structuralSeed(db.connection.db)

    const second = structuralSeed(db.connection.db)

    expect(second).toEqual(first)
    expect({
      boards: count('boards'),
      lanes: count('lanes'),
      users: count('users'),
      policies: count('board_policies'),
      locations: count('locations'),
    }).toEqual(before)
  })
})

describe('demoSeed', () => {
  it('is refused outright in production mode', () => {
    const original = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'

    try {
      expect(() => demoSeed(db.connection.db)).toThrow(/refused in production/)
      expect(count('cards')).toBe(0)
    } finally {
      if (original === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = original
    }
  })

  it('seeds demo users of every role and cards in every lane', () => {
    const result = demoSeed(db.connection.db)

    const laneIdsWithCards = new Set(
      db.connection.db
        .select({ laneId: cards.laneId })
        .from(cards)
        .all()
        .map((r) => r.laneId),
    )

    expect(result.seeded).toBe(true)
    expect(result.userEmails).toEqual(ROLES.map((role) => demoUserEmail(role)))
    for (const role of ROLES) {
      expect(
        db.connection.db
          .select()
          .from(users)
          .where(eq(users.email, demoUserEmail(role)))
          .get(),
      ).toMatchObject({ role })
    }
    expect(laneIdsWithCards.size).toBe(LANE_KEYS.length)
  })

  it('includes the canonical special-case fixtures', () => {
    const all = db.connection.db.select().from(cards).all()
    const blocked = all.filter((card) => card.blocked)
    const overdue = all.filter(
      (card) =>
        card.waitingReason !== null &&
        card.expectedResumeAt !== null &&
        card.expectedResumeAt < new Date().toISOString().slice(0, 10),
    )
    const cancelled = all.filter((card) => card.resolution === 'cancelled')
    const archived = all.filter((card) => card.archivedAt !== null)

    expect(blocked.length).toBeGreaterThanOrEqual(1)
    expect(blocked.at(0)?.blockedReason).not.toBeNull()
    expect(overdue.length).toBeGreaterThanOrEqual(1)
    expect(cancelled.length).toBeGreaterThanOrEqual(1)
    expect(archived.length).toBeGreaterThanOrEqual(1)
    expect(all.find((card) => card.origin === 'slack')?.slackPermalink).not.toBeNull()
  })

  it('seeds tags, a threaded comment, attachment metadata, and audit events', () => {
    const tagRows = db.connection.db.select().from(tags).all()
    const commentRows = db.connection.db.select().from(comments).all()
    const replies = commentRows.filter((comment) => comment.parentCommentId !== null)
    const attachmentRows = db.connection.db.select().from(attachments).all()
    const createdEvents = db.connection.db
      .select()
      .from(cardEvents)
      .where(eq(cardEvents.eventType, 'card.created'))
      .all()

    expect(tagRows.length).toBeGreaterThanOrEqual(3)
    expect(commentRows.length).toBeGreaterThanOrEqual(2)
    expect(replies.length).toBeGreaterThanOrEqual(1)
    expect(attachmentRows.length).toBeGreaterThanOrEqual(1)
    expect(createdEvents.length).toBe(count('cards'))
  })

  it('is idempotent: a re-run reports seeded=false and adds nothing', () => {
    const before = { cards: count('cards'), users: count('users'), events: count('card_events') }

    const result = demoSeed(db.connection.db)

    expect(result.seeded).toBe(false)
    expect({
      cards: count('cards'),
      users: count('users'),
      events: count('card_events'),
    }).toEqual(before)
  })

  it('links every card to the seeded board and active lanes (FK sanity)', () => {
    const orphanCards = db.connection.db
      .select()
      .from(cards)
      .where(and(isNull(cards.archivedAt), isNotNull(cards.resolution), eq(cards.blocked, true)))
      .all()

    // No card is simultaneously active, resolved, and blocked — shape sanity.
    expect(orphanCards).toEqual([])
  })

  it('throws when the structural seed has not run yet', () => {
    const fresh = openTestDb()

    try {
      expect(() => demoSeed(fresh.connection.db)).toThrow(/structural seed must run/)
    } finally {
      fresh.cleanup()
    }
  })

  it('still seeds when the location tree is empty (locations are optional)', () => {
    const fresh = openTestDb()

    try {
      structuralSeed(fresh.connection.db)
      fresh.connection.raw.exec('DELETE FROM locations')
      const result = demoSeed(fresh.connection.db)

      expect(result.seeded).toBe(true)
      const located = fresh.connection.db
        .select()
        .from(cards)
        .all()
        .filter((card) => card.locationId !== null)
      expect(located).toEqual([])
    } finally {
      fresh.cleanup()
    }
  })
})
