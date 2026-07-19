import {
  cardEventSchema,
  type ActorKind,
  type CardEvent,
  type CardEventType,
  type CursorKey,
  type EventRepository,
} from '@rivian-kanban/core'
import { and, asc, desc, eq, gt, gte, inArray, lt, or, type SQL } from 'drizzle-orm'
import { toError } from '../../errors.ts'
import { cardEvents } from '../../schema.pg.ts'
import { type PgDb } from '../database.ts'

export class PgEventRepository implements EventRepository {
  private readonly db: PgDb

  constructor(db: PgDb) {
    this.db = db
  }

  /** Append-only — the audit trail is never updated or deleted (ADR-005). */
  async append(event: CardEvent): Promise<void> {
    try {
      await this.db.insert(cardEvents).values(event)
    } catch (error) {
      throw toError(error)
    }
  }

  /** One event by id (notification fan-out resolves the actor), payload validated. */
  async findById(id: string): Promise<CardEvent | null> {
    const rows = await this.db.select().from(cardEvents).where(eq(cardEvents.id, id)).limit(1)
    return rows[0] === undefined ? null : cardEventSchema.parse(rows[0])
  }

  /**
   * Per-card history, oldest-first on (createdAt ASC, id ASC); `after` returns
   * rows strictly newer than the cursor tuple — the pinned port contract.
   * Rows hydrate through cardEventSchema so the payload union is validated,
   * not cast.
   */
  async listByCard(
    cardId: number,
    options?: { types?: readonly CardEventType[]; after?: CursorKey; limit?: number },
  ): Promise<CardEvent[]> {
    if (options?.types?.length === 0) {
      return []
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
          // Event cursors carry the UUID event id; String() is a no-op on it.
          and(eq(cardEvents.createdAt, after.createdAt), gt(cardEvents.id, String(after.id))),
        ),
      )
    }
    const query = this.db
      .select()
      .from(cardEvents)
      .where(and(...conditions))
      .orderBy(asc(cardEvents.createdAt), asc(cardEvents.id))
    const rows = await (options?.limit !== undefined ? query.limit(options.limit) : query)
    return rows.map((row) => cardEventSchema.parse(row))
  }

  /**
   * The newest `limit` events, newest-first on (createdAt DESC, id DESC) —
   * the O(limit) read behind "latest events" panels and last-arrival lookups,
   * optionally filtered by event type (port contract).
   */
  async listLatestByCard(
    cardId: number,
    limit: number,
    types?: readonly CardEventType[],
  ): Promise<CardEvent[]> {
    if (types?.length === 0) return []
    const rows = await this.db
      .select()
      .from(cardEvents)
      .where(
        and(
          eq(cardEvents.cardId, cardId),
          types === undefined ? undefined : inArray(cardEvents.eventType, [...types]),
        ),
      )
      .orderBy(desc(cardEvents.createdAt), desc(cardEvents.id))
      .limit(limit)
    return rows.map((row) => cardEventSchema.parse(row))
  }

  /**
   * Board-wide activity feed, newest-first on (createdAt DESC, id DESC),
   * bounded by `createdAt >= sinceIso`; `after` returns rows strictly older
   * than the cursor tuple — the pinned port contract (mirrors query()).
   */
  async listBoardSince(
    sinceIso: string,
    options?: {
      types?: readonly CardEventType[]
      cardId?: number
      actorKind?: ActorKind
      actorIds?: readonly string[]
      after?: CursorKey
      limit?: number
    },
  ): Promise<CardEvent[]> {
    // Empty allowlists match nothing (self-scoped feed with no ids to itself).
    if (options?.types?.length === 0 || options?.actorIds?.length === 0) {
      return []
    }
    const conditions: (SQL | undefined)[] = [gte(cardEvents.createdAt, sinceIso)]
    if (options?.types !== undefined) {
      conditions.push(inArray(cardEvents.eventType, [...options.types]))
    }
    if (options?.cardId !== undefined) conditions.push(eq(cardEvents.cardId, options.cardId))
    if (options?.actorKind !== undefined) {
      conditions.push(eq(cardEvents.actorKind, options.actorKind))
    }
    if (options?.actorIds !== undefined) {
      conditions.push(inArray(cardEvents.actorId, [...options.actorIds]))
    }
    const after = options?.after
    if (after !== undefined) {
      conditions.push(
        or(
          lt(cardEvents.createdAt, after.createdAt),
          // Event cursors carry the UUID event id; String() is a no-op on it.
          and(eq(cardEvents.createdAt, after.createdAt), lt(cardEvents.id, String(after.id))),
        ),
      )
    }
    const query = this.db
      .select()
      .from(cardEvents)
      .where(and(...conditions))
      .orderBy(desc(cardEvents.createdAt), desc(cardEvents.id))
    const rows = await (options?.limit !== undefined ? query.limit(options.limit) : query)
    return rows.map((row) => cardEventSchema.parse(row))
  }
}
