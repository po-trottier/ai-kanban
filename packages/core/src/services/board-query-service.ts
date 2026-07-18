import { z } from 'zod'
import {
  listCardsFilterSchema,
  pageRequestSchema,
  type ListCardsFilter,
} from '../domain/commands.ts'
import {
  ACTOR_KINDS,
  DEFAULT_BLOCKED_STALE_DAYS,
  DEFAULT_REVIEW_STALE_DAYS,
} from '../domain/constants.ts'
import { decodeCursor, encodeCursor, type CursorKey } from '../domain/cursor.ts'
import { isOverdueResume, utcDayOf } from '../domain/dates.ts'
import {
  isoDateTimeSchema,
  type Attachment,
  type Card,
  type Comment,
  type Lane,
  type Location,
  type Tag,
} from '../domain/entities.ts'
import { boardCardOf, type BoardCard } from '../domain/envelopes.ts'
import { CARD_EVENT_TYPES, type CardEvent } from '../domain/events.ts'
import {
  type CardQueryFilter,
  type TransactionContext,
  type UnitOfWork,
} from '../ports/repositories.ts'
import { type Clock } from '../ports/runtime.ts'
import { DAY_MS, laneByKey, redactDeletedComments, requireFound } from './internal.ts'

export interface BoardQueryServiceDeps {
  uow: UnitOfWork
  clock: Clock
  boardId: string
}

/**
 * One lane with its non-archived card summaries in position order plus WIP
 * state. Summaries, not full cards (rest-api.md#history--metadata): the
 * snapshot is refetched by every client on every mutation hint, so it never
 * carries descriptions or Slack bookkeeping.
 */
export interface LaneSnapshot {
  lane: Lane
  cards: BoardCard[]
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

/** `CardDetail` plus the redacted comment thread and the trailing audit events. */
export interface CardDetailWithThread extends CardDetail {
  comments: Comment[]
  latestEvents: CardEvent[]
}

export interface Page<T> {
  items: T[]
  nextCursor: string | null
}

/**
 * Read-time attribution for service-token (mcp) actors: the stored `actorId`
 * is the token id (audit integrity, ADR-005), so the read path resolves it to
 * the token's `name` (`actorLabel`) and its creator (`onBehalfOfUserId`) — the
 * "<token> on behalf of <user>" line. Both are absent for non-mcp actors and
 * derived, never stored (docs/architecture/rest-api.md). Distributed over the
 * discriminated union so each variant keeps its narrowed `eventType`/`payload`.
 */
export type EnrichedCardEvent = CardEvent & {
  actorLabel?: string
  onBehalfOfUserId?: string
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
 * Board-wide activity feed request (`GET /events`, MCP `list_activity`): every
 * card event since `sinceIso`, newest-first, cursor-paginated — all filters
 * optional. `sinceIso` defaults to 24h before now, applied in `eventsSince`
 * via the injected Clock (core never reads the wall clock directly). Shared by
 * REST and MCP (single-schema rule).
 */
export const activityFeedRequestSchema = pageRequestSchema.extend({
  sinceIso: isoDateTimeSchema.optional(),
  type: z.enum(CARD_EVENT_TYPES).optional(),
  cardId: z.uuid().optional(),
  actorKind: z.enum(ACTOR_KINDS).optional(),
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
    return this.deps.uow.read(async (tx) => {
      const lanes = await tx.lanes.listByBoard(this.deps.boardId)
      const snapshots: LaneSnapshot[] = []
      for (const lane of lanes) {
        // activeOnly + the join-sourced extras (tags/attachmentCount/location)
        // in one bounded read per lane: the hottest read in the system must
        // never hydrate the unbounded done-lane archive nor fan out per card.
        const rows = await tx.cards.listBoardSummariesByLane(lane.id)
        snapshots.push({
          lane,
          cards: rows.map((row) => boardCardOf(row.card, row.extras)),
          wipLimitExceeded: lane.wipLimit !== null && rows.length > lane.wipLimit,
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
    return this.deps.uow.read(async (tx) => {
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
    return this.deps.uow.read((tx) => tx.tags.listAll())
  }

  /** The board's lanes in board order (`GET /lanes`, MCP `list_lanes`). */
  async listLanes(): Promise<Lane[]> {
    return this.deps.uow.read((tx) => tx.lanes.listByBoard(this.deps.boardId))
  }

  /** Full card detail: card + tags + location + active attachment metadata. */
  async cardDetail(cardId: string): Promise<CardDetail> {
    return this.deps.uow.read(async (tx) => {
      const card = requireFound(await tx.cards.findById(cardId), 'card')
      return detailOf(tx, card)
    })
  }

  /**
   * The MCP `get_card` composition: full detail plus the redacted comment
   * thread and the trailing `latestEventsTake` audit events (chronological;
   * O(take) — the repository reads newest-first with a LIMIT). Composed
   * inside ONE read snapshot with one card lookup, so the three parts can
   * never disagree about a concurrently committed mutation.
   */
  async cardDetailWithThread(
    cardId: string,
    latestEventsTake: number,
  ): Promise<CardDetailWithThread> {
    return this.deps.uow.read(async (tx) => {
      const card = requireFound(await tx.cards.findById(cardId), 'card')
      const detail = await detailOf(tx, card)
      const comments = redactDeletedComments(await tx.comments.listByCard(card.id))
      const latestEvents = (await tx.events.listLatestByCard(card.id, latestEventsTake)).reverse()
      return { ...detail, comments, latestEvents }
    })
  }

  /** Per-card audit history, oldest-first, filterable by event type. */
  async cardHistory(cardId: string, rawRequest?: unknown): Promise<Page<EnrichedCardEvent>> {
    const request = cardHistoryRequestSchema.parse(rawRequest ?? {})
    const after = request.cursor !== undefined ? decodeCursor(request.cursor) : undefined
    return this.deps.uow.read(async (tx) => {
      requireFound(await tx.cards.findById(cardId), 'card')
      const events = await tx.events.listByCard(cardId, {
        ...(request.type !== undefined ? { types: [request.type] } : {}),
        ...(after !== undefined ? { after } : {}),
        limit: request.limit + 1,
      })
      const page = paginate(events, request.limit, (event) => ({
        createdAt: event.createdAt,
        id: event.id,
      }))
      return { ...page, items: await enrichMcpActors(tx, page.items) }
    })
  }

  /**
   * Board-wide activity feed: card events across ALL cards since `sinceIso`
   * (default 24h before now, resolved via the injected Clock), newest-first,
   * cursor-paginated on (createdAt, id) exactly like `listCards`. Filters
   * (type/cardId/actorKind) are all optional. mcp actors are enriched with
   * `actorLabel`/`onBehalfOfUserId` like `cardHistory`.
   */
  async eventsSince(rawRequest?: unknown): Promise<Page<EnrichedCardEvent>> {
    const request = activityFeedRequestSchema.parse(rawRequest ?? {})
    const sinceIso =
      request.sinceIso ?? new Date(this.deps.clock.now().getTime() - DAY_MS).toISOString()
    const after = request.cursor !== undefined ? decodeCursor(request.cursor) : undefined
    return this.deps.uow.read(async (tx) => {
      const events = await tx.events.listBoardSince(sinceIso, {
        ...(request.type !== undefined ? { types: [request.type] } : {}),
        ...(request.cardId !== undefined ? { cardId: request.cardId } : {}),
        ...(request.actorKind !== undefined ? { actorKind: request.actorKind } : {}),
        ...(after !== undefined ? { after } : {}),
        limit: request.limit + 1,
      })
      const page = paginate(events, request.limit, (event) => ({
        createdAt: event.createdAt,
        id: event.id,
      }))
      return { ...page, items: await enrichMcpActors(tx, page.items) }
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
    return this.deps.uow.read(async (tx) => {
      const stale = new Map<string, StaleCard>()
      const mark = (card: Card, reason: StaleReason) => {
        const entry = stale.get(card.id) ?? { card, reasons: [] }
        entry.reasons.push(reason)
        stale.set(card.id, entry)
      }

      const waiting = await laneByKey(tx, this.deps.boardId, 'waiting_parts_vendor')
      const today = utcDayOf(now)
      for (const card of await activeLaneCards(tx, waiting.id)) {
        if (isOverdueResume(card.expectedResumeAt, today)) {
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

      // Board-scoped like the lane legs above (the multi-board seam); the
      // partial live-blocked index keeps this proportional to blocked cards.
      for (const card of await tx.cards.query({ boardId: this.deps.boardId, blocked: true })) {
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
    if (filter.locationId !== undefined) {
      // Recursively inclusive: selecting a building matches every card in its
      // floors and rooms (its whole subtree), not just cards pinned to the
      // building node itself.
      repoFilter.locationIds = await locationSubtreeIds(tx, filter.locationId)
    }
    // `tags` (any-of, advanced search) supersedes the single `tag` (MCP etc.).
    const tags = filter.tags ?? (filter.tag !== undefined ? [filter.tag] : undefined)
    if (tags !== undefined && tags.length > 0) repoFilter.tags = tags
    if (filter.blocked !== undefined) repoFilter.blocked = filter.blocked
    if (filter.waitingReason !== undefined) repoFilter.waitingReason = filter.waitingReason
    if (filter.overdueResume === true) {
      repoFilter.overdueBefore = utcDayOf(this.deps.clock.now())
    }
    if (filter.q !== undefined) repoFilter.q = filter.q
    if (filter.includeArchived !== undefined) repoFilter.includeArchived = filter.includeArchived
    if (filter.archivedOnly !== undefined) repoFilter.archivedOnly = filter.archivedOnly
    return repoFilter
  }
}

async function activeLaneCards(tx: TransactionContext, laneId: string): Promise<Card[]> {
  return tx.cards.listByLane(laneId, { activeOnly: true })
}

/**
 * The selected location plus every descendant (building → floors → rooms), so
 * a location filter is recursively inclusive. Walks the flat location list by
 * parentId; an unknown root simply yields itself (matching no card).
 */
async function locationSubtreeIds(tx: TransactionContext, rootId: string): Promise<string[]> {
  const all = await tx.locations.list()
  const childrenByParent = new Map<string, string[]>()
  for (const location of all) {
    if (location.parentId === null) continue
    const siblings = childrenByParent.get(location.parentId) ?? []
    siblings.push(location.id)
    childrenByParent.set(location.parentId, siblings)
  }
  const ids: string[] = []
  const stack = [rootId]
  while (stack.length > 0) {
    const id = stack.pop()
    if (id === undefined) continue
    ids.push(id)
    const children = childrenByParent.get(id)
    if (children !== undefined) stack.push(...children)
  }
  return ids
}

/** The card's detail composition — shared by `cardDetail` and `cardDetailWithThread`. */
async function detailOf(tx: TransactionContext, card: Card): Promise<CardDetail> {
  const tags = await tx.tags.listByCard(card.id)
  const location = card.locationId === null ? null : await tx.locations.findById(card.locationId)
  const attachments = (await tx.attachments.listByCard(card.id)).filter(
    (attachment) => attachment.deletedAt === null,
  )
  return { card, tags, location, attachments }
}

/**
 * When the card last arrived in the review lane (falls back to creation).
 * O(1): a card sitting in review got there by a cross-lane move, and any
 * later `card.status_changed` would have moved it elsewhere — so the newest
 * status event IS the arrival, read with LIMIT 1 instead of scanning the
 * card's whole append-only history.
 */
async function reviewEnteredAt(tx: TransactionContext, card: Card): Promise<string> {
  const newest = (await tx.events.listLatestByCard(card.id, 1, ['card.status_changed'])).at(0)
  if (newest?.eventType === 'card.status_changed' && newest.payload.toLane === 'review') {
    return newest.createdAt
  }
  return card.createdAt
}

/**
 * Read-time attribution for mcp events: the stored actorId is the service-token
 * id, resolved here to the token name + its creator. One `list()` covers every
 * distinct token in the page (tokens are few, admin-managed), so no N+1 and no
 * new port method. Revoked tokens still have a row, so their name still resolves.
 */
async function enrichMcpActors(
  tx: TransactionContext,
  events: CardEvent[],
): Promise<EnrichedCardEvent[]> {
  const hasMcp = events.some((event) => event.actorKind === 'mcp')
  if (!hasMcp) return events
  const tokensById = new Map((await tx.serviceTokens.list()).map((row) => [row.id, row]))
  return events.map((event) => {
    const token =
      event.actorKind === 'mcp' && event.actorId !== null && tokensById.get(event.actorId)
    if (!token) return event
    return { ...event, actorLabel: token.name, onBehalfOfUserId: token.createdBy }
  })
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
