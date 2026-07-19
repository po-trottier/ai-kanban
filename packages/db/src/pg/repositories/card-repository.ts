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
import {
  attachments,
  cardEvents,
  cardRelations,
  cards,
  cardTags,
  cardWatchers,
  comments,
  locations,
  notifications,
  tags,
} from '../../schema.pg.ts'
import { toError } from '../../errors.ts'
import { type PgDb } from '../database.ts'
import { mapPgCardWriteError } from '../errors.ts'

/** Escapes LIKE wildcards so `q` is a literal substring match (`ESCAPE '\'`). */
function escapeLike(needle: string): string {
  return needle.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
}

export class PgCardRepository implements CardRepository {
  private readonly db: PgDb

  constructor(db: PgDb) {
    this.db = db
  }

  async findById(id: number): Promise<Card | null> {
    const rows = await this.db.select().from(cards).where(eq(cards.id, id)).limit(1)
    return rows[0] ?? null
  }

  async nextCardId(boardId: string): Promise<number> {
    // MAX(id)+1 per board — the id IS the ticket number; atomic inside the
    // create transaction (the unit-of-work), the id PK is the backstop.
    const rows = await this.db
      .select({ max: sql<number | null>`max(${cards.id})` })
      .from(cards)
      .where(eq(cards.boardId, boardId))
    return (rows[0]?.max ?? 0) + 1
  }

  async insert(card: Card): Promise<void> {
    try {
      await this.db.insert(cards).values(card)
    } catch (error) {
      throw mapPgCardWriteError(error)
    }
  }

  async update(card: Card): Promise<void> {
    try {
      const updated = await this.db
        .update(cards)
        .set(card)
        .where(eq(cards.id, card.id))
        .returning({ id: cards.id })
      if (updated.length === 0) throw new NotFoundError('card')
    } catch (error) {
      throw mapPgCardWriteError(error)
    }
  }

  async listByLane(laneId: string, options?: { activeOnly?: boolean }): Promise<Card[]> {
    // TEXT position keys compare byte-wise (COLLATE "C") — the fractional
    // ordering contract (ADR-006). activeOnly pushes the archived filter into
    // SQL so hot reads never hydrate the done-lane archive.
    return this.db
      .select()
      .from(cards)
      .where(
        and(
          eq(cards.laneId, laneId),
          options?.activeOnly === true ? isNull(cards.archivedAt) : undefined,
        ),
      )
      .orderBy(asc(cards.position))
  }

  /**
   * Attaches the board extras (tag names, active-attachment count, leaf location
   * name) to location-joined card rows — two grouped reads over the row set, not
   * per-card. Shared by both board-summary reads (by-lane and filtered).
   */
  private async attachExtras(
    rows: { card: Card; locationLabel: string | null }[],
  ): Promise<BoardCardRow[]> {
    if (rows.length === 0) return []

    const cardIds = rows.map((row) => row.card.id)
    const tagRows = await this.db
      .select({ cardId: cardTags.cardId, name: tags.name })
      .from(cardTags)
      .innerJoin(tags, eq(cardTags.tagId, tags.id))
      .where(inArray(cardTags.cardId, cardIds))
      .orderBy(asc(tags.name))
    const tagsByCard = new Map<number, string[]>()
    for (const { cardId, name } of tagRows) {
      const list = tagsByCard.get(cardId) ?? []
      list.push(name)
      tagsByCard.set(cardId, list)
    }

    const attachmentRows = await this.db
      // count() is bigint → a string on the wire; Number() folds it to a number.
      .select({ cardId: attachments.cardId, count: sql<string>`count(*)` })
      .from(attachments)
      .where(and(inArray(attachments.cardId, cardIds), isNull(attachments.deletedAt)))
      .groupBy(attachments.cardId)
    const attachmentCountByCard = new Map(
      attachmentRows.map((row) => [row.cardId, Number(row.count)]),
    )

    return rows.map((row) => ({
      card: row.card,
      extras: {
        tags: tagsByCard.get(row.card.id) ?? [],
        attachmentCount: attachmentCountByCard.get(row.card.id) ?? 0,
        locationLabel: row.locationLabel,
      },
    }))
  }

  async listBoardSummariesByLane(laneId: string): Promise<BoardCardRow[]> {
    const rows = await this.db
      .select({ card: cards, locationLabel: locations.name })
      .from(cards)
      .leftJoin(locations, eq(cards.locationId, locations.id))
      .where(and(eq(cards.laneId, laneId), isNull(cards.archivedAt)))
      .orderBy(asc(cards.position))
    return this.attachExtras(rows)
  }

  /** Index-only COUNT under the partial live-rows index (port contract). */
  async countActiveByLane(laneId: string): Promise<number> {
    const rows = await this.db
      .select({ count: sql<string>`count(*)` })
      .from(cards)
      .where(and(eq(cards.laneId, laneId), isNull(cards.archivedAt)))
    return Number(rows[0]?.count ?? '0')
  }

  /** O(1) lane-boundary read (port contract): `ORDER BY position LIMIT 1`. */
  async edgeOfLane(laneId: string, edge: 'first' | 'last'): Promise<Card | null> {
    const rows = await this.db
      .select()
      .from(cards)
      .where(eq(cards.laneId, laneId))
      .orderBy(edge === 'first' ? asc(cards.position) : desc(cards.position))
      .limit(1)
    return rows[0] ?? null
  }

  /**
   * The filter → SQL conditions shared by `query` (keyset list) and
   * `queryBoardSummaries` (filtered board). Excludes the cursor tuple, which is
   * pagination-specific. Every facet is pushed into SQL.
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
      conditions.push(isNotNull(cards.workStartedAt), isNotNull(cards.estimateMinutes))
    }
    if (filter.tags !== undefined && filter.tags.length > 0) {
      // Any-of: the card carries at least one of the wanted tags (lower()-folded).
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
      // Both sides folded by lower() so ASCII matching stays case-insensitive.
      const pattern = `%${escapeLike(filter.q)}%`
      conditions.push(
        sql`lower(${cards.title} || ${'\n'} || ${cards.description}) like lower(${pattern}) escape '\\'`,
      )
    }
    return conditions
  }

  async query(
    filter: CardQueryFilter,
    page?: { after?: CursorKey; limit?: number },
  ): Promise<Card[]> {
    const conditions = this.filterConditions(filter)
    const after = page?.after
    if (after !== undefined) {
      // Strictly older than the cursor tuple under (createdAt DESC, id DESC).
      conditions.push(
        or(
          lt(cards.createdAt, after.createdAt),
          and(eq(cards.createdAt, after.createdAt), lt(cards.id, Number(after.id))),
        ),
      )
    }
    const base = this.db
      .select()
      .from(cards)
      .where(and(...conditions))
      .orderBy(desc(cards.createdAt), desc(cards.id))
    return page?.limit !== undefined ? base.limit(page.limit) : base
  }

  async queryBoardSummaries(filter: CardQueryFilter): Promise<BoardCardRow[]> {
    const rows = await this.db
      .select({ card: cards, locationLabel: locations.name })
      .from(cards)
      .leftJoin(locations, eq(cards.locationId, locations.id))
      .where(and(...this.filterConditions(filter)))
      .orderBy(asc(cards.position))
    return this.attachExtras(rows)
  }

  /**
   * Hard-deletes the card and every FK-referencing row in ONE transaction
   * (a nested savepoint under the unit-of-work). Every child references
   * `cards.id` with ON DELETE NO ACTION, so children are deleted BEFORE the
   * cards row. The attachments' storageKeys are read before their rows go so
   * the service can drop the blobs after commit. NotFoundError if id absent.
   */
  async hardDelete(id: number): Promise<{ storageKeys: string[] }> {
    try {
      return await this.db.transaction(async (tx) => {
        const found = await tx.select({ id: cards.id }).from(cards).where(eq(cards.id, id)).limit(1)
        if (found[0] === undefined) throw new NotFoundError('card')
        const keys = (
          await tx
            .select({ storageKey: attachments.storageKey })
            .from(attachments)
            .where(eq(attachments.cardId, id))
        ).map((row) => row.storageKey)

        await tx.delete(cardTags).where(eq(cardTags.cardId, id))
        await tx.delete(comments).where(eq(comments.cardId, id))
        await tx.delete(attachments).where(eq(attachments.cardId, id))
        await tx.delete(cardEvents).where(eq(cardEvents.cardId, id))
        await tx
          .delete(cardRelations)
          .where(or(eq(cardRelations.fromCardId, id), eq(cardRelations.toCardId, id)))
        await tx.delete(cardWatchers).where(eq(cardWatchers.cardId, id))
        await tx.delete(notifications).where(eq(notifications.cardId, id))
        await tx.delete(cards).where(eq(cards.id, id))
        return { storageKeys: keys }
      })
    } catch (error) {
      throw toError(error)
    }
  }
}
