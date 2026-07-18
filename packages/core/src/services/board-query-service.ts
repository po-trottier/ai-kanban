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
import { isOverdueResume, isWorkOverdue, utcDayOf } from '../domain/dates.ts'
import { boardFilterSchema, type BoardFilter } from '../domain/filters.ts'
import {
  isoDateTimeSchema,
  userSchema,
  type Actor,
  type Attachment,
  type Card,
  type Comment,
  type Lane,
  type Location,
  type Tag,
} from '../domain/entities.ts'
import { boardCardOf, type BoardCard } from '../domain/envelopes.ts'
import { CARD_EVENT_TYPES, type CardEvent } from '../domain/events.ts'
import { hasPermission } from '../policy/policy-engine.ts'
import {
  type BoardCardRow,
  type CardQueryFilter,
  type TransactionContext,
  type UnitOfWork,
} from '../ports/repositories.ts'
import { type Clock } from '../ports/runtime.ts'
import { activePolicy, DAY_MS, laneByKey, redactDeletedComments, requireFound } from './internal.ts'

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

/**
 * A feed event's read-time name resolution ON TOP of the mcp attribution:
 * `actorDisplayName` for user/slack actors, and an `onBehalfOfDisplayName`
 * companion to `onBehalfOfUserId` (mcp). Both derived from the same page-wide
 * user batch that fills the feed's `users` map — companions for rendering, the
 * map is the authoritative lookup covering ids the companions don't (snapshot
 * reporter/assignee). Absent when the referenced user can't be resolved.
 */
export type EnrichedActivityEvent = EnrichedCardEvent & {
  actorDisplayName?: string
  onBehalfOfDisplayName?: string
}

/**
 * The users-map value: id + displayName + email for every user id the feed
 * references (actors, on-behalf, and each `card.created` snapshot's
 * reporter/assignee). Email rides along like the admin users table — the
 * cross-user feed is gated behind `viewAllActivity`, and a self-scoped caller
 * only ever sees their own ids.
 */
export const activityUserSchema = userSchema.pick({ id: true, displayName: true, email: true })
export type ActivityUser = z.infer<typeof activityUserSchema>

/**
 * The board-wide activity feed envelope (`GET /events`, MCP `list_activity`):
 * the cursor page of enriched events PLUS a top-level `users` map resolving
 * every referenced id in one place. Parameterized by the event-item and user
 * schemas (single-schema rule) so REST supplies stripping wrappers and MCP the
 * strict core schemas.
 */
export function activityFeedSchemaOf<E extends z.ZodType, U extends z.ZodType>(parts: {
  event: E
  user: U
}) {
  return z.object({
    items: z.array(parts.event),
    nextCursor: z.string().nullable(),
    users: z.record(z.uuid(), parts.user),
  })
}

/** Core's `Page<EnrichedActivityEvent>` plus the resolved `users` map. */
export interface ActivityFeed {
  items: EnrichedActivityEvent[]
  nextCursor: string | null
  users: Record<string, ActivityUser>
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
  cardId: z.coerce.number().int().positive().optional(),
  actorKind: z.enum(ACTOR_KINDS).optional(),
})

/**
 * Read-side queries. Card reads are never policy-checked (every authenticated
 * user may see every card, ADR-008); no audit events are written. The sole
 * exception is `eventsSince`: the cross-user activity feed is gated on
 * `viewAllActivity`, self-scoping callers who lack it (see the method).
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
   * The board narrowed by a `BoardFilter`, grouped by lane
   * (docs/architecture/board-filters.md). Every facet is pushed into the DB
   * query; the `overdue` facet is finished here over the DB-narrowed candidate
   * set (`overdueCandidate` predicate) — SQLite cannot count business hours, so
   * the service applies `isWorkOverdue` in UTC business minutes. Never an
   * in-memory whole-board scan. `wipLimitExceeded` reflects the FULL active lane
   * count (the WIP marker is a property of the lane, not the filtered view), so
   * filtering never hides a breach. The empty filter equals `boardSnapshot`.
   */
  async filteredBoard(rawFilter: unknown): Promise<BoardSnapshot> {
    const filter = boardFilterSchema.parse(rawFilter)
    const now = this.deps.clock.now()
    return this.deps.uow.read(async (tx) => {
      const repoFilter = await this.toBoardRepoFilter(tx, filter)
      let rows = await tx.cards.queryBoardSummaries(repoFilter)
      if (filter.overdue) {
        // Candidate set already restricted to started+estimated cards in SQL;
        // finish the business-minutes verdict here (consistent with ADR-019).
        rows = rows.filter((row) =>
          isWorkOverdue(row.card.workStartedAt, row.card.estimateMinutes, now),
        )
      }
      const byLane = new Map<string, BoardCardRow[]>()
      for (const row of rows) {
        const list = byLane.get(row.card.laneId) ?? []
        list.push(row)
        byLane.set(row.card.laneId, list)
      }
      const lanes = await tx.lanes.listByBoard(this.deps.boardId)
      const snapshots: LaneSnapshot[] = []
      for (const lane of lanes) {
        const laneRows = byLane.get(lane.id) ?? []
        // WIP is a property of the whole lane, so read the true active count
        // rather than the filtered slice — filtering must not mask a breach.
        const activeCount = await tx.cards.countActiveByLane(lane.id)
        snapshots.push({
          lane,
          cards: laneRows.map((row) => boardCardOf(row.card, row.extras)),
          wipLimitExceeded: lane.wipLimit !== null && activeCount > lane.wipLimit,
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
  async cardDetail(cardId: number): Promise<CardDetail> {
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
    cardId: number,
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
  async cardHistory(cardId: number, rawRequest?: unknown): Promise<Page<EnrichedCardEvent>> {
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
   * (type/cardId/actorKind) are all optional.
   *
   * ACCESS (docs/architecture/mcp.md): the CROSS-USER feed is gated behind the
   * `viewAllActivity` permission. A caller without it is scoped to their OWN
   * activity — events where `actorId` is the caller OR an mcp token they minted
   * (the "on behalf of" line). For an mcp actor the on-behalf user is the
   * token's `createdBy`. Scoping is pushed into the query (`actorIds`), never
   * filtered in memory, so pagination stays correct.
   *
   * NAMES: every returned item resolves user/slack actor names and an mcp
   * `onBehalfOf` companion, and a top-level `users` map covers every referenced
   * id (actors, on-behalf, each `card.created` snapshot's reporter/assignee) —
   * batch-resolved with ONE users read per page (no N+1).
   */
  async eventsSince(actor: Actor, rawRequest?: unknown): Promise<ActivityFeed> {
    const request = activityFeedRequestSchema.parse(rawRequest ?? {})
    const sinceIso =
      request.sinceIso ?? new Date(this.deps.clock.now().getTime() - DAY_MS).toISOString()
    const after = request.cursor !== undefined ? decodeCursor(request.cursor) : undefined
    return this.deps.uow.read(async (tx) => {
      const policy = await activePolicy(tx, this.deps.boardId)
      const actorIds = hasPermission(actor, 'viewAllActivity', policy)
        ? undefined
        : await selfActorIds(tx, actor)
      const events = await tx.events.listBoardSince(sinceIso, {
        ...(request.type !== undefined ? { types: [request.type] } : {}),
        ...(request.cardId !== undefined ? { cardId: request.cardId } : {}),
        ...(request.actorKind !== undefined ? { actorKind: request.actorKind } : {}),
        ...(actorIds !== undefined ? { actorIds } : {}),
        ...(after !== undefined ? { after } : {}),
        limit: request.limit + 1,
      })
      const page = paginate(events, request.limit, (event) => ({
        createdAt: event.createdAt,
        id: event.id,
      }))
      const items = await enrichMcpActors(tx, page.items)
      return resolveActivityNames(tx, items, page.nextCursor)
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
      const stale = new Map<number, StaleCard>()
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
        const left = `${a.card.createdAt}/${String(a.card.id)}`
        const right = `${b.card.createdAt}/${String(b.card.id)}`
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

  /**
   * Maps the flat `BoardFilter` (docs/architecture/board-filters.md) to the
   * repository's `CardQueryFilter`. Board-scoped (multi-board seam); every
   * non-empty facet becomes a pushed-into-SQL condition. `scope` becomes the
   * archived selector; `overdue` becomes the `overdueCandidate` DB predicate
   * (the business-minutes verdict is finished in `filteredBoard`).
   */
  private async toBoardRepoFilter(
    tx: TransactionContext,
    filter: BoardFilter,
  ): Promise<CardQueryFilter> {
    const repoFilter: CardQueryFilter = { boardId: this.deps.boardId }
    if (filter.priorities.length > 0) repoFilter.priorities = filter.priorities
    if (filter.laneKeys.length > 0) {
      const lanes = await tx.lanes.listByBoard(this.deps.boardId)
      const idByKey = new Map(lanes.map((lane) => [lane.key, lane.id]))
      repoFilter.laneIds = filter.laneKeys.map((key) => idByKey.get(key) ?? key)
    }
    if (filter.assigneeIds.length > 0) repoFilter.assigneeIds = filter.assigneeIds
    if (filter.reporterIds.length > 0) repoFilter.reporterIds = filter.reporterIds
    if (filter.tags.length > 0) repoFilter.tags = filter.tags
    if (filter.locationIds.length > 0) {
      // Each selected location expands to its whole subtree (recursively
      // inclusive), unioned — a building matches its floors and rooms.
      const expanded = new Set<string>()
      for (const locationId of filter.locationIds) {
        for (const id of await locationSubtreeIds(tx, locationId)) expanded.add(id)
      }
      repoFilter.locationIds = [...expanded]
    }
    if (filter.scope === 'archived') repoFilter.archivedOnly = true
    else if (filter.scope === 'all') repoFilter.includeArchived = true
    if (filter.q !== '') repoFilter.q = filter.q
    if (filter.overdue) repoFilter.overdueCandidate = true
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

/**
 * The user ids that count as the caller's OWN activity for the self-scoped
 * feed: the caller's user id plus every service-token id they minted (their
 * events land as `actorId = <tokenId>`). For an mcp actor the caller IS a
 * token — the on-behalf user is its `createdBy`, and that user's own tokens
 * include this one. One `serviceTokens.list()` (tokens are few, admin-managed).
 * An unknown/revoked token with no resolvable creator scopes to just itself.
 */
async function selfActorIds(tx: TransactionContext, actor: Actor): Promise<string[]> {
  const tokens = await tx.serviceTokens.list()
  const userId =
    actor.kind === 'mcp' ? tokens.find((token) => token.id === actor.id)?.createdBy : actor.id
  if (userId === undefined) return [actor.id]
  const mintedTokenIds = tokens
    .filter((token) => token.createdBy === userId)
    .map((token) => token.id)
  return [userId, ...mintedTokenIds]
}

/**
 * Every user id a feed item references: the user/slack actor, the mcp
 * on-behalf user, and each `card.created` snapshot's reporter + assignee (the
 * task's named set). mcp/system `actorId`s are token/null and excluded.
 */
function referencedUserIds(event: EnrichedActivityEvent): string[] {
  const ids: string[] = []
  if ((event.actorKind === 'user' || event.actorKind === 'slack') && event.actorId !== null) {
    ids.push(event.actorId)
  }
  if (event.onBehalfOfUserId !== undefined) ids.push(event.onBehalfOfUserId)
  if (event.eventType === 'card.created') {
    ids.push(event.payload.snapshot.reporterId)
    if (event.payload.snapshot.assigneeId !== null) ids.push(event.payload.snapshot.assigneeId)
  }
  return ids
}

/**
 * Resolves the page's user ids to display names in ONE users read: fills the
 * top-level `users` map (id → {id, displayName, email}) covering every
 * referenced id, and stamps the `actorDisplayName` / `onBehalfOfDisplayName`
 * render companions on each item. Ids that don't resolve are simply absent.
 */
async function resolveActivityNames(
  tx: TransactionContext,
  events: EnrichedActivityEvent[],
  nextCursor: string | null,
): Promise<ActivityFeed> {
  const referenced = new Set(events.flatMap(referencedUserIds))
  const users: Record<string, ActivityUser> = {}
  if (referenced.size > 0) {
    for (const user of await tx.userAccounts.list()) {
      if (referenced.has(user.id)) {
        // Project to the map value (id/displayName/email); the full User row
        // carries strictObject-rejected extras, so pick rather than parse.
        users[user.id] = { id: user.id, displayName: user.displayName, email: user.email }
      }
    }
  }
  const items = events.map((event) => {
    const actorName =
      (event.actorKind === 'user' || event.actorKind === 'slack') && event.actorId !== null
        ? users[event.actorId]?.displayName
        : undefined
    const onBehalfName =
      event.onBehalfOfUserId !== undefined ? users[event.onBehalfOfUserId]?.displayName : undefined
    return {
      ...event,
      ...(actorName !== undefined ? { actorDisplayName: actorName } : {}),
      ...(onBehalfName !== undefined ? { onBehalfOfDisplayName: onBehalfName } : {}),
    }
  })
  return { items, nextCursor, users }
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
