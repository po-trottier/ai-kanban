import {
  NotFoundError,
  type Card,
  type CardQueryFilter,
  type CardRepository,
  type CursorKey,
} from '@rivian-kanban/core'
import { and, asc, desc, eq, exists, isNull, lt, or, sql, type SQL } from 'drizzle-orm'
import { type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { mapCardWriteError } from '../errors.ts'
import { cards, cardTags, tags } from '../schema.ts'

/** Escapes LIKE wildcards so `q` is a literal substring match (`ESCAPE '\'`). */
function escapeLike(needle: string): string {
  return needle.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
}

export class SqliteCardRepository implements CardRepository {
  private readonly db: BetterSQLite3Database

  constructor(db: BetterSQLite3Database) {
    this.db = db
  }

  findById(id: string): Promise<Card | null> {
    const row = this.db.select().from(cards).where(eq(cards.id, id)).get()
    return Promise.resolve(row ?? null)
  }

  insert(card: Card): Promise<void> {
    try {
      this.db.insert(cards).values(card).run()
      return Promise.resolve()
    } catch (error) {
      return Promise.reject(mapCardWriteError(error))
    }
  }

  update(card: Card): Promise<void> {
    try {
      const result = this.db.update(cards).set(card).where(eq(cards.id, card.id)).run()
      if (result.changes === 0) return Promise.reject(new NotFoundError('card'))
      return Promise.resolve()
    } catch (error) {
      return Promise.reject(mapCardWriteError(error))
    }
  }

  listByLane(laneId: string): Promise<Card[]> {
    // TEXT position keys compare byte-wise (BINARY collation) — the fractional
    // ordering contract (ADR-006).
    const rows = this.db
      .select()
      .from(cards)
      .where(eq(cards.laneId, laneId))
      .orderBy(asc(cards.position))
      .all()
    return Promise.resolve(rows)
  }

  query(filter: CardQueryFilter, page?: { after?: CursorKey; limit?: number }): Promise<Card[]> {
    const conditions: (SQL | undefined)[] = []
    if (filter.includeArchived !== true) conditions.push(isNull(cards.archivedAt))
    if (filter.laneId !== undefined) conditions.push(eq(cards.laneId, filter.laneId))
    if (filter.assigneeId !== undefined) conditions.push(eq(cards.assigneeId, filter.assigneeId))
    if (filter.reporterId !== undefined) conditions.push(eq(cards.reporterId, filter.reporterId))
    if (filter.priority !== undefined) {
      conditions.push(eq(cards.priority, filter.priority))
    }
    if (filter.blocked !== undefined) conditions.push(eq(cards.blocked, filter.blocked))
    if (filter.waitingReason !== undefined) {
      conditions.push(eq(cards.waitingReason, filter.waitingReason))
    }
    if (filter.overdueBefore !== undefined) {
      // NULL expected_resume_at never satisfies `<` — matches the port contract.
      conditions.push(lt(cards.expectedResumeAt, filter.overdueBefore))
    }
    if (filter.tag !== undefined) {
      conditions.push(
        exists(
          this.db
            .select({ one: sql`1` })
            .from(cardTags)
            .innerJoin(tags, eq(cardTags.tagId, tags.id))
            .where(
              and(eq(cardTags.cardId, cards.id), sql`lower(${tags.name}) = lower(${filter.tag})`),
            ),
        ),
      )
    }
    if (filter.q !== undefined) {
      // Both sides folded by SQLite's lower() (ASCII-only without ICU) so they
      // use the same collapse: ASCII matching stays case-insensitive and an
      // exact non-ASCII substring always matches. Folding the needle in JS
      // instead (full Unicode fold) would silently miss e.g. 'Éclairage'.
      const pattern = `%${escapeLike(filter.q)}%`
      conditions.push(
        sql`lower(${cards.title} || ${'\n'} || ${cards.description}) like lower(${pattern}) escape '\\'`,
      )
    }
    const after = page?.after
    if (after !== undefined) {
      // Strictly older than the cursor tuple under (createdAt DESC, id DESC) —
      // the exact keyset contract BoardQueryService pagination depends on.
      conditions.push(
        or(
          lt(cards.createdAt, after.createdAt),
          and(eq(cards.createdAt, after.createdAt), lt(cards.id, after.id)),
        ),
      )
    }
    const query = this.db
      .select()
      .from(cards)
      .where(and(...conditions))
      .orderBy(desc(cards.createdAt), desc(cards.id))
    const rows = page?.limit !== undefined ? query.limit(page.limit).all() : query.all()
    return Promise.resolve(rows)
  }
}
