import {
  NotFoundError,
  type BoardCardRow,
  type Card,
  type CardQueryFilter,
  type CardRepository,
  type CursorKey,
} from '@rivian-kanban/core'
import {
  and,
  asc,
  desc,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'
import { type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { mapCardWriteError } from '../errors.ts'
import { attachments, cards, cardTags, locations, tags } from '../schema.ts'

/** Escapes LIKE wildcards so `q` is a literal substring match (`ESCAPE '\'`). */
function escapeLike(needle: string): string {
  return needle.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
}

export class SqliteCardRepository implements CardRepository {
  private readonly db: BetterSQLite3Database

  constructor(db: BetterSQLite3Database) {
    this.db = db
  }

  findById(id: number): Promise<Card | null> {
    const row = this.db.select().from(cards).where(eq(cards.id, id)).get()
    return Promise.resolve(row ?? null)
  }

  nextCardId(boardId: string): Promise<number> {
    // MAX(id)+1 per board — the id IS the ticket number; atomic inside the
    // create transaction (SQLite single writer), the id PK is the backstop.
    const row = this.db
      .select({ max: sql<number | null>`max(${cards.id})` })
      .from(cards)
      .where(eq(cards.boardId, boardId))
      .get()
    return Promise.resolve((row?.max ?? 0) + 1)
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

  listByLane(laneId: string, options?: { activeOnly?: boolean }): Promise<Card[]> {
    // TEXT position keys compare byte-wise (BINARY collation) — the fractional
    // ordering contract (ADR-006). activeOnly pushes the archived filter into
    // SQL so hot reads never hydrate the done-lane archive (port contract).
    const rows = this.db
      .select()
      .from(cards)
      .where(
        and(
          eq(cards.laneId, laneId),
          options?.activeOnly === true ? isNull(cards.archivedAt) : undefined,
        ),
      )
      .orderBy(asc(cards.position))
      .all()
    return Promise.resolve(rows)
  }

  listBoardSummariesByLane(laneId: string): Promise<BoardCardRow[]> {
    // The active cards in position order plus the leaf location name (LEFT
    // JOIN so location-less cards survive) — the same activeOnly filter and
    // ORDER BY as listByLane, so the partial live-rows index still serves it.
    const rows = this.db
      .select({ card: cards, locationLabel: locations.name })
      .from(cards)
      .leftJoin(locations, eq(cards.locationId, locations.id))
      .where(and(eq(cards.laneId, laneId), isNull(cards.archivedAt)))
      .orderBy(asc(cards.position))
      .all()
    if (rows.length === 0) return Promise.resolve([])

    const cardIds = rows.map((row) => row.card.id)
    // Tag names per card (case-preserved stored form) and the active-attachment
    // count per card — two grouped reads over the lane's cards, not per-card.
    const tagRows = this.db
      .select({ cardId: cardTags.cardId, name: tags.name })
      .from(cardTags)
      .innerJoin(tags, eq(cardTags.tagId, tags.id))
      .where(inArray(cardTags.cardId, cardIds))
      .orderBy(asc(tags.name))
      .all()
    const tagsByCard = new Map<number, string[]>()
    for (const { cardId, name } of tagRows) {
      const list = tagsByCard.get(cardId) ?? []
      list.push(name)
      tagsByCard.set(cardId, list)
    }

    const attachmentRows = this.db
      .select({ cardId: attachments.cardId, count: sql<number>`count(*)` })
      .from(attachments)
      .where(and(inArray(attachments.cardId, cardIds), isNull(attachments.deletedAt)))
      .groupBy(attachments.cardId)
      .all()
    const attachmentCountByCard = new Map(attachmentRows.map((row) => [row.cardId, row.count]))

    return Promise.resolve(
      rows.map((row) => ({
        card: row.card,
        extras: {
          tags: tagsByCard.get(row.card.id) ?? [],
          attachmentCount: attachmentCountByCard.get(row.card.id) ?? 0,
          locationLabel: row.locationLabel,
        },
      })),
    )
  }

  /** Index-only COUNT under the partial live-rows index (port contract). */
  countActiveByLane(laneId: string): Promise<number> {
    const row = this.db
      .select({ count: sql<number>`count(*)` })
      .from(cards)
      .where(and(eq(cards.laneId, laneId), isNull(cards.archivedAt)))
      .get()
    return Promise.resolve(row?.count ?? 0)
  }

  /** O(1) lane-boundary read (port contract): `ORDER BY position LIMIT 1`. */
  edgeOfLane(laneId: string, edge: 'first' | 'last'): Promise<Card | null> {
    const row = this.db
      .select()
      .from(cards)
      .where(eq(cards.laneId, laneId))
      .orderBy(edge === 'first' ? asc(cards.position) : desc(cards.position))
      .limit(1)
      .get()
    return Promise.resolve(row ?? null)
  }

  /**
   * The filter → SQL conditions shared by `query` (keyset list) and
   * `queryBoardSummaries` (filtered board). Excludes the cursor tuple, which is
   * pagination-specific. Every facet is pushed into SQL — no in-memory filtering
   * (docs/architecture/board-filters.md).
   */
  private filterConditions(filter: CardQueryFilter): (SQL | undefined)[] {
    const conditions: (SQL | undefined)[] = []
    if (filter.archivedOnly === true) {
      conditions.push(isNotNull(cards.archivedAt))
    } else if (filter.includeArchived !== true) {
      conditions.push(isNull(cards.archivedAt))
    }
    if (filter.boardId !== undefined) conditions.push(eq(cards.boardId, filter.boardId))
    if (filter.laneId !== undefined) conditions.push(eq(cards.laneId, filter.laneId))
    if (filter.laneIds !== undefined && filter.laneIds.length > 0) {
      conditions.push(inArray(cards.laneId, filter.laneIds))
    }
    if (filter.assigneeId !== undefined) conditions.push(eq(cards.assigneeId, filter.assigneeId))
    if (filter.assigneeIds !== undefined && filter.assigneeIds.length > 0) {
      conditions.push(inArray(cards.assigneeId, filter.assigneeIds))
    }
    if (filter.reporterId !== undefined) conditions.push(eq(cards.reporterId, filter.reporterId))
    if (filter.reporterIds !== undefined && filter.reporterIds.length > 0) {
      conditions.push(inArray(cards.reporterId, filter.reporterIds))
    }
    if (filter.priority !== undefined) {
      conditions.push(eq(cards.priority, filter.priority))
    }
    if (filter.priorities !== undefined && filter.priorities.length > 0) {
      conditions.push(inArray(cards.priority, filter.priorities))
    }
    if (filter.locationIds !== undefined && filter.locationIds.length > 0) {
      conditions.push(inArray(cards.locationId, filter.locationIds))
    }
    if (filter.blocked !== undefined) conditions.push(eq(cards.blocked, filter.blocked))
    if (filter.waitingReason !== undefined) {
      conditions.push(eq(cards.waitingReason, filter.waitingReason))
    }
    if (filter.overdueBefore !== undefined) {
      // NULL expected_resume_at never satisfies `<` — matches the port contract.
      conditions.push(lt(cards.expectedResumeAt, filter.overdueBefore))
    }
    if (filter.overdueCandidate === true) {
      // Only started+estimated cards CAN be overdue; the business-minutes
      // verdict is finished in the service (SQLite can't count business hours).
      conditions.push(isNotNull(cards.workStartedAt), isNotNull(cards.estimateMinutes))
    }
    if (filter.tags !== undefined && filter.tags.length > 0) {
      // Any-of: the card carries at least one of the wanted tags (lower()-folded
      // like the single-tag path, ASCII case-insensitive).
      const wanted = filter.tags.map((name) => name.toLowerCase())
      conditions.push(
        exists(
          this.db
            .select({ one: sql`1` })
            .from(cardTags)
            .innerJoin(tags, eq(cardTags.tagId, tags.id))
            .where(and(eq(cardTags.cardId, cards.id), inArray(sql`lower(${tags.name})`, wanted))),
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
    return conditions
  }

  query(filter: CardQueryFilter, page?: { after?: CursorKey; limit?: number }): Promise<Card[]> {
    const conditions = this.filterConditions(filter)
    const after = page?.after
    if (after !== undefined) {
      // Strictly older than the cursor tuple under (createdAt DESC, id DESC) —
      // the exact keyset contract BoardQueryService pagination depends on.
      conditions.push(
        or(
          lt(cards.createdAt, after.createdAt),
          // Card cursors carry the integer card id; Number() is a no-op on it.
          and(eq(cards.createdAt, after.createdAt), lt(cards.id, Number(after.id))),
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

  queryBoardSummaries(filter: CardQueryFilter): Promise<BoardCardRow[]> {
    // The matching cards in position order + the leaf location name (LEFT JOIN
    // so location-less cards survive) — the same extras pattern as
    // listBoardSummariesByLane, but the whole filtered set across lanes.
    const rows = this.db
      .select({ card: cards, locationLabel: locations.name })
      .from(cards)
      .leftJoin(locations, eq(cards.locationId, locations.id))
      .where(and(...this.filterConditions(filter)))
      .orderBy(asc(cards.position))
      .all()
    if (rows.length === 0) return Promise.resolve([])

    const cardIds = rows.map((row) => row.card.id)
    const tagRows = this.db
      .select({ cardId: cardTags.cardId, name: tags.name })
      .from(cardTags)
      .innerJoin(tags, eq(cardTags.tagId, tags.id))
      .where(inArray(cardTags.cardId, cardIds))
      .orderBy(asc(tags.name))
      .all()
    const tagsByCard = new Map<number, string[]>()
    for (const { cardId, name } of tagRows) {
      const list = tagsByCard.get(cardId) ?? []
      list.push(name)
      tagsByCard.set(cardId, list)
    }

    const attachmentRows = this.db
      .select({ cardId: attachments.cardId, count: sql<number>`count(*)` })
      .from(attachments)
      .where(and(inArray(attachments.cardId, cardIds), isNull(attachments.deletedAt)))
      .groupBy(attachments.cardId)
      .all()
    const attachmentCountByCard = new Map(attachmentRows.map((row) => [row.cardId, row.count]))

    return Promise.resolve(
      rows.map((row) => ({
        card: row.card,
        extras: {
          tags: tagsByCard.get(row.card.id) ?? [],
          attachmentCount: attachmentCountByCard.get(row.card.id) ?? 0,
          locationLabel: row.locationLabel,
        },
      })),
    )
  }
}
