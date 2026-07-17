import {
  cardEventSchema,
  type CardEvent,
  type CardEventType,
  type CursorKey,
  type EventRepository,
} from '@rivian-kanban/core'
import { and, asc, desc, eq, gt, inArray, or, type SQL } from 'drizzle-orm'
import { type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { toError } from '../errors.ts'
import { cardEvents } from '../schema.ts'

export class SqliteEventRepository implements EventRepository {
  private readonly db: BetterSQLite3Database

  constructor(db: BetterSQLite3Database) {
    this.db = db
  }

  /** Append-only — the audit trail is never updated or deleted (ADR-005). */
  append(event: CardEvent): Promise<void> {
    try {
      this.db.insert(cardEvents).values(event).run()
      return Promise.resolve()
    } catch (error) {
      return Promise.reject(toError(error))
    }
  }

  /**
   * Per-card history, oldest-first on (createdAt ASC, id ASC); `after` returns
   * rows strictly newer than the cursor tuple — the pinned port contract.
   * Rows hydrate through cardEventSchema so the payload union is validated,
   * not cast.
   */
  listByCard(
    cardId: string,
    options?: { types?: readonly CardEventType[]; after?: CursorKey; limit?: number },
  ): Promise<CardEvent[]> {
    if (options?.types?.length === 0) {
      return Promise.resolve([])
    }
    const conditions: (SQL | undefined)[] = [eq(cardEvents.cardId, cardId)]
    if (options?.types !== undefined) {
      conditions.push(inArray(cardEvents.eventType, [...options.types]))
    }
    const after = options?.after
    if (after !== undefined) {
      conditions.push(
        or(
          gt(cardEvents.createdAt, after.createdAt),
          and(eq(cardEvents.createdAt, after.createdAt), gt(cardEvents.id, after.id)),
        ),
      )
    }
    const query = this.db
      .select()
      .from(cardEvents)
      .where(and(...conditions))
      .orderBy(asc(cardEvents.createdAt), asc(cardEvents.id))
    const rows = options?.limit !== undefined ? query.limit(options.limit).all() : query.all()
    return Promise.resolve(rows.map((row) => cardEventSchema.parse(row)))
  }

  /**
   * The newest `limit` events, newest-first on (createdAt DESC, id DESC) —
   * the O(limit) read behind "latest events" panels (port contract).
   */
  listLatestByCard(cardId: string, limit: number): Promise<CardEvent[]> {
    const rows = this.db
      .select()
      .from(cardEvents)
      .where(eq(cardEvents.cardId, cardId))
      .orderBy(desc(cardEvents.createdAt), desc(cardEvents.id))
      .limit(limit)
      .all()
    return Promise.resolve(rows.map((row) => cardEventSchema.parse(row)))
  }
}
