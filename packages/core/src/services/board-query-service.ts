import { z } from 'zod'
import {
  listCardsFilterSchema,
  pageRequestSchema,
  type ListCardsFilter,
} from '../domain/commands.ts'
import { DEFAULT_BLOCKED_STALE_DAYS, DEFAULT_REVIEW_STALE_DAYS } from '../domain/constants.ts'
import { decodeCursor, encodeCursor, type CursorKey } from '../domain/cursor.ts'
import {
  type Attachment,
  type Card,
  type Lane,
  type Location,
  type Tag,
} from '../domain/entities.ts'
import { CARD_EVENT_TYPES, type CardEvent } from '../domain/events.ts'
import {
  type CardQueryFilter,
  type TransactionContext,
  type UnitOfWork,
} from '../ports/repositories.ts'
import { type Clock } from '../ports/runtime.ts'
import { DAY_MS, laneByKey, requireFound, utcDateOf } from './internal.ts'

export interface BoardQueryServiceDeps {
  uow: UnitOfWork
  clock: Clock
  boardId: string
}

/** One lane with its non-archived cards in position order plus WIP state. */
export interface LaneSnapshot {
  lane: Lane
  cards: Card[]
  wipLimitExceeded: boolean
}

export interface BoardSnapshot {
  lanes: LaneSnapshot[]
}

export interface CardDetail {
  card: Card
  tags: Tag[]
  location: Location | null
  /** Active (non-soft-deleted) attachment metadata. */
  attachments: Attachment[]
}

export interface Page<T> {
  items: T[]
  nextCursor: string | null
}

export const STALE_REASONS = ['overdue_resume', 'stale_review', 'stale_blocked'] as const
export type StaleReason = (typeof STALE_REASONS)[number]

export interface StaleCard {
  card: Card
  reasons: StaleReason[]
}

/** Shared by `staleCards` and the MCP `list_stale_cards` tool (single-schema rule). */
export const staleCardsInputSchema = z.strictObject({
  reviewDays: z.number().int().positive().default(DEFAULT_REVIEW_STALE_DAYS),
  blockedDays: z.number().int().positive().default(DEFAULT_BLOCKED_STALE_DAYS),
})

/** Extends the shared pagination envelope (single-schema rule) with a type filter. */
export const cardHistoryRequestSchema = pageRequestSchema.extend({
  type: z.enum(CARD_EVENT_TYPES).optional(),
})

/**
 * Read-side queries. Reads are never policy-checked (every authenticated user
 * may see every card, ADR-008); no audit events are written.
 */
export class BoardQueryService {
  private readonly deps: BoardQueryServiceDeps

  constructor(deps: BoardQueryServiceDeps) {
    this.deps = deps
  }

  /** Lanes in board order with non-archived cards in position order + WIP state. */
  async boardSnapshot(): Promise<BoardSnapshot> {
    return this.deps.uow.run(async (tx) => {
      const lanes = await tx.lanes.listByBoard(this.deps.boardId)
      const snapshots: LaneSnapshot[] = []
      for (const lane of lanes) {
        const cards = (await tx.cards.listByLane(lane.id)).filter(
          (card) => card.archivedAt === null,
        )
        snapshots.push({
          lane,
          cards,
          wipLimitExceeded: lane.wipLimit !== null && cards.length > lane.wipLimit,
        })
      }
      return { lanes: snapshots }
    })
  }

  /**
   * Filterable card list, newest-first, cursor-paginated on (createdAt, id).
   * The cursor is the shared opaque base64url token (REST and MCP alike).
   */
  async listCards(rawFilter: unknown, rawPage?: unknown): Promise<Page<Card>> {
    const filter = listCardsFilterSchema.parse(rawFilter)
    const page = pageRequestSchema.parse(rawPage ?? {})
    const after = page.cursor !== undefined ? decodeCursor(page.cursor) : undefined
    return this.deps.uow.run(async (tx) => {
      const repoFilter = await this.toRepoFilter(tx, filter)
      const items = await tx.cards.query(repoFilter, {
        ...(after !== undefined ? { after } : {}),
        limit: page.limit + 1,
      })
      return paginate(items, page.limit, (card) => ({ createdAt: card.createdAt, id: card.id }))
    })
  }

  /** Every known tag, name order (`GET /tags` autocomplete). */
  async listTags(): Promise<Tag[]> {
    return this.deps.uow.run((tx) => tx.tags.listAll())
  }

  /** Full card detail: card + tags + location + active attachment metadata. */
  async cardDetail(cardId: string): Promise<CardDetail> {
    return this.deps.uow.run(async (tx) => {
      const card = requireFound(await tx.cards.findById(cardId), 'card')
      const tags = await tx.tags.listByCard(card.id)
      const location =
        card.locationId === null ? null : await tx.locations.findById(card.locationId)
      const attachments = (await tx.attachments.listByCard(card.id)).filter(
        (attachment) => attachment.deletedAt === null,
      )
      return { card, tags, location, attachments }
    })
  }

  /** Per-card audit history, oldest-first, filterable by event type. */
  async cardHistory(cardId: string, rawRequest?: unknown): Promise<Page<CardEvent>> {
    const request = cardHistoryRequestSchema.parse(rawRequest ?? {})
    const after = request.cursor !== undefined ? decodeCursor(request.cursor) : undefined
    return this.deps.uow.run(async (tx) => {
      requireFound(await tx.cards.findById(cardId), 'card')
      const events = await tx.events.listByCard(cardId, {
        ...(request.type !== undefined ? { types: [request.type] } : {}),
        ...(after !== undefined ? { after } : {}),
        limit: request.limit + 1,
      })
      return paginate(events, request.limit, (event) => ({
        createdAt: event.createdAt,
        id: event.id,
      }))
    })
  }

  /**
   * The trailing `take` audit events in chronological order — the "latest
   * events" panel of the MCP `get_card` tool. O(take) regardless of history
   * depth (the repository reads newest-first with a LIMIT).
   */
  async latestEvents(cardId: string, take: number): Promise<CardEvent[]> {
    return this.deps.uow.run(async (tx) => {
      requireFound(await tx.cards.findById(cardId), 'card')
      const newestFirst = await tx.events.listLatestByCard(cardId, take)
      return newestFirst.reverse()
    })
  }

  /**
   * The follow-up feed (`list_stale_cards`): cards past `expectedResumeAt`
   * (overdue starts the UTC day after the date), in review longer than
   * `reviewDays` (default 7), or blocked longer than `blockedDays` (default 3).
   */
  async staleCards(rawInput?: unknown): Promise<StaleCard[]> {
    const input = staleCardsInputSchema.parse(rawInput ?? {})
    const now = this.deps.clock.now()
    return this.deps.uow.run(async (tx) => {
      const stale = new Map<string, StaleCard>()
      const mark = (card: Card, reason: StaleReason) => {
        const entry = stale.get(card.id) ?? { card, reasons: [] }
        entry.reasons.push(reason)
        stale.set(card.id, entry)
      }

      const waiting = await laneByKey(tx, this.deps.boardId, 'waiting_parts_vendor')
      const today = utcDateOf(now)
      for (const card of await activeLaneCards(tx, waiting.id)) {
        if (card.expectedResumeAt !== null && card.expectedResumeAt < today) {
          mark(card, 'overdue_resume')
        }
      }

      const review = await laneByKey(tx, this.deps.boardId, 'review')
      for (const card of await activeLaneCards(tx, review.id)) {
        const enteredAt = await reviewEnteredAt(tx, card)
        if (now.getTime() - new Date(enteredAt).getTime() > input.reviewDays * DAY_MS) {
          mark(card, 'stale_review')
        }
      }

      for (const card of await tx.cards.query({ blocked: true })) {
        if (
          card.blockedAt !== null &&
          now.getTime() - new Date(card.blockedAt).getTime() > input.blockedDays * DAY_MS
        ) {
          mark(card, 'stale_blocked')
        }
      }

      return [...stale.values()].sort((a, b) => {
        const left = `${a.card.createdAt}/${a.card.id}`
        const right = `${b.card.createdAt}/${b.card.id}`
        if (left < right) return -1
        return left > right ? 1 : 0
      })
    })
  }

  private async toRepoFilter(
    tx: TransactionContext,
    filter: ListCardsFilter,
  ): Promise<CardQueryFilter> {
    const repoFilter: CardQueryFilter = {}
    if (filter.lane !== undefined) {
      repoFilter.laneId = (await laneByKey(tx, this.deps.boardId, filter.lane)).id
    }
    if (filter.assignee !== undefined) repoFilter.assigneeId = filter.assignee
    if (filter.reporter !== undefined) repoFilter.reporterId = filter.reporter
    if (filter.priority !== undefined) repoFilter.priority = filter.priority
    if (filter.tag !== undefined) repoFilter.tag = filter.tag
    if (filter.blocked !== undefined) repoFilter.blocked = filter.blocked
    if (filter.waitingReason !== undefined) repoFilter.waitingReason = filter.waitingReason
    if (filter.overdueResume === true) {
      repoFilter.overdueBefore = utcDateOf(this.deps.clock.now())
    }
    if (filter.q !== undefined) repoFilter.q = filter.q
    if (filter.includeArchived !== undefined) repoFilter.includeArchived = filter.includeArchived
    return repoFilter
  }
}

async function activeLaneCards(tx: TransactionContext, laneId: string): Promise<Card[]> {
  return (await tx.cards.listByLane(laneId)).filter((card) => card.archivedAt === null)
}

/** When the card last arrived in the review lane (falls back to creation). */
async function reviewEnteredAt(tx: TransactionContext, card: Card): Promise<string> {
  const statusEvents = await tx.events.listByCard(card.id, { types: ['card.status_changed'] })
  const lastArrival = statusEvents
    .filter(
      (event) => event.eventType === 'card.status_changed' && event.payload.toLane === 'review',
    )
    .at(-1)
  return lastArrival?.createdAt ?? card.createdAt
}

/** Fetch limit+1 rows, then slice and derive the opaque nextCursor. */
function paginate<T>(rows: T[], limit: number, keyOf: (row: T) => CursorKey): Page<T> {
  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  const last = items.at(-1)
  return {
    items,
    nextCursor: hasMore && last !== undefined ? encodeCursor(keyOf(last)) : null,
  }
}
