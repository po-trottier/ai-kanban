import { generateKeyBetween } from 'fractional-indexing'
import {
  blockCardInputSchema,
  cancelCardInputSchema,
  createCardInputSchema,
  moveCardInputSchema,
  reopenCardInputSchema,
  unblockCardInputSchema,
  updateCardInputSchema,
  waitingLaneEntrySchema,
} from '../domain/commands.ts'
import { DONE_ARCHIVAL_DAYS, type ActorKind, type CardOrigin } from '../domain/constants.ts'
import { utcDayOf } from '../domain/dates.ts'
import { ConflictError, NotFoundError } from '../domain/errors.ts'
import { type Actor, type Card, type User } from '../domain/entities.ts'
import { type AuditedCardField, type CardEvent } from '../domain/events.ts'
import { evaluatePolicy } from '../policy/policy-engine.ts'
import { type TransactionContext, type UnitOfWork } from '../ports/repositories.ts'
import { type Clock, type EventBus, type IdGenerator, type NotifierPort } from '../ports/runtime.ts'
import {
  activePolicy,
  decide,
  ensureNotArchived,
  ensureVersion,
  laneByKey,
  laneOfCard,
  makeEvent,
  publishCardHints,
  requireFound,
  resolveTags,
  runWithPositionRetry,
  sameTagSet,
  type CardEventBody,
} from './internal.ts'

export interface CardServiceDeps {
  uow: UnitOfWork
  clock: Clock
  ids: IdGenerator
  eventBus: EventBus
  notifier: NotifierPort
  boardId: string
  /** The seeded automation user — hidden from pickers, never a valid assignee. */
  systemUserId: string
}

/**
 * Trusted, adapter-only creation context — an in-process parameter, never part
 * of the client-parseable `createCardInputSchema` (reporter = acting user for
 * web clients, docs/architecture/rest-api.md).
 */
export interface CreateCardOptions {
  /**
   * Resolved reporter user id: the MCP adapter passes the user matched from
   * `reporterEmail` or the seeded system user (docs/architecture/mcp.md).
   * Defaults to the acting user.
   */
  reporterId?: string
  /** Source metadata recorded for Slack-created cards (docs/architecture/slack.md). */
  slackSource?: {
    channelId: string
    threadTs: string
    permalink: string
  }
}

/** No v1 flow creates cards as the system actor; `pm`/`import` are reserved (vision.md). */
function originOf(kind: ActorKind): CardOrigin {
  switch (kind) {
    case 'user':
      return 'manual'
    case 'mcp':
      return 'mcp'
    case 'slack':
      return 'slack'
    case 'system':
      throw new Error('system actors do not create cards in v1 (origin pm is reserved)')
  }
}

interface MutationResult {
  card: Card
  events: CardEvent[]
}

interface MoveResult extends MutationResult {
  /** True when the move completed the card (non-cancel entry into done). */
  completed: boolean
}

/**
 * Card lifecycle. Every mutation runs in one unit of work, writes its audit
 * event(s) in that same transaction (ADR-005), bumps the optimistic-lock
 * version (ADR-012), and publishes SSE hints after commit (ADR-008).
 */
export class CardService {
  private readonly deps: CardServiceDeps

  constructor(deps: CardServiceDeps) {
    this.deps = deps
  }

  /**
   * Creates a card in `intake` at the top of the lane, origin derived from the
   * actor surface, reporter defaulting to the acting user. `options` is
   * trusted adapter context (resolved reporter, Slack source metadata) that
   * clients can never reach — the parsed body matches rest-api.md exactly.
   *
   * Policy checks: `card.create` (read-scope tokens denied; otherwise permissive).
   * Audit events: `card.created` with a full snapshot including tags.
   */
  async create(actor: Actor, rawInput: unknown, options: CreateCardOptions = {}): Promise<Card> {
    const input = createCardInputSchema.parse(rawInput)
    const origin = originOf(actor.kind)
    const result = await runWithPositionRetry(this.deps.uow, async (tx) => {
      const policy = await activePolicy(tx, this.deps.boardId)
      decide(evaluatePolicy(actor, { type: 'card.create' }, policy))

      const reporterId = options.reporterId ?? actor.id
      requireFound(await tx.users.findById(reporterId), 'reporter')
      if (input.assigneeId !== undefined) {
        await this.requireAssignable(tx, input.assigneeId)
      }
      if (input.locationId !== undefined) {
        requireFound(await tx.locations.findById(input.locationId), 'location')
      }

      const intake = await laneByKey(tx, this.deps.boardId, 'intake')
      const top = await tx.cards.edgeOfLane(intake.id, 'first')
      const nowIso = this.deps.clock.now().toISOString()
      const card: Card = {
        id: this.deps.ids.newId(),
        boardId: this.deps.boardId,
        laneId: intake.id,
        position: generateKeyBetween(null, top?.position ?? null),
        title: input.title,
        description: input.description,
        priority: input.priority,
        estimateMinutes: input.estimateMinutes ?? null,
        reporterId,
        assigneeId: input.assigneeId ?? null,
        locationId: input.locationId ?? null,
        origin,
        resolution: null,
        blocked: false,
        blockedReason: null,
        blockedAt: null,
        waitingReason: null,
        expectedResumeAt: null,
        resumeAlertedAt: null,
        slackChannelId: options.slackSource?.channelId ?? null,
        slackThreadTs: options.slackSource?.threadTs ?? null,
        slackPermalink: options.slackSource?.permalink ?? null,
        version: 1,
        createdAt: nowIso,
        updatedAt: nowIso,
        archivedAt: null,
      }
      await tx.cards.insert(card)
      const tags = await resolveTags(tx, this.deps.ids, input.tags)
      await tx.tags.setCardTags(
        card.id,
        tags.map((tag) => tag.id),
      )
      const event = makeEvent(this.deps.ids, this.deps.clock, actor, card.id, {
        eventType: 'card.created',
        payload: { snapshot: { ...card, tags: tags.map((tag) => tag.name) } },
      })
      await tx.events.append(event)
      return { card, events: [event] } satisfies MutationResult
    })
    publishCardHints(this.deps.eventBus, result.card, result.events)
    return result.card
  }

  /**
   * Per-field edits with full-replacement tag semantics. A no-change update is
   * a no-op (no version bump, no events).
   *
   * Policy checks: `card.update`; archived cards are read-only (409); stale
   * `expectedVersion` conflicts (409).
   * Audit events: one `card.field_changed` per changed field.
   */
  async update(actor: Actor, cardId: string, rawInput: unknown): Promise<Card> {
    const input = updateCardInputSchema.parse(rawInput)
    const result = await this.deps.uow.run(async (tx) => {
      const card = requireFound(await tx.cards.findById(cardId), 'card')
      ensureNotArchived(card)
      const policy = await activePolicy(tx, card.boardId)
      decide(evaluatePolicy(actor, { type: 'card.update' }, policy))
      ensureVersion(card, input.expectedVersion)

      const next: Card = { ...card }
      const events: CardEvent[] = []
      const fieldChanged = (body: CardEventBody) => {
        events.push(makeEvent(this.deps.ids, this.deps.clock, actor, card.id, body))
      }

      if (input.title !== undefined && input.title !== card.title) {
        next.title = input.title
        fieldChanged(changeOf('title', card.title, input.title))
      }
      if (input.description !== undefined && input.description !== card.description) {
        next.description = input.description
        fieldChanged(changeOf('description', card.description, input.description))
      }
      if (input.priority !== undefined && input.priority !== card.priority) {
        next.priority = input.priority
        fieldChanged(changeOf('priority', card.priority, input.priority))
      }
      if (input.estimateMinutes !== undefined && input.estimateMinutes !== card.estimateMinutes) {
        next.estimateMinutes = input.estimateMinutes
        fieldChanged(changeOf('estimateMinutes', card.estimateMinutes, input.estimateMinutes))
      }
      if (input.assigneeId !== undefined && input.assigneeId !== card.assigneeId) {
        if (input.assigneeId !== null) {
          await this.requireAssignable(tx, input.assigneeId)
        }
        next.assigneeId = input.assigneeId
        fieldChanged(changeOf('assigneeId', card.assigneeId, input.assigneeId))
      }
      if (input.locationId !== undefined && input.locationId !== card.locationId) {
        if (input.locationId !== null) {
          requireFound(await tx.locations.findById(input.locationId), 'location')
        }
        next.locationId = input.locationId
        fieldChanged(changeOf('locationId', card.locationId, input.locationId))
      }
      if (input.tags !== undefined) {
        const fromNames = (await tx.tags.listByCard(card.id)).map((tag) => tag.name)
        const resolved = await resolveTags(tx, this.deps.ids, input.tags)
        const toNames = resolved.map((tag) => tag.name)
        if (!sameTagSet(fromNames, toNames)) {
          await tx.tags.setCardTags(
            card.id,
            resolved.map((tag) => tag.id),
          )
          fieldChanged(changeOf('tags', fromNames, toNames))
        }
      }

      if (events.length === 0) return { card, events } satisfies MutationResult
      next.version = card.version + 1
      next.updatedAt = this.deps.clock.now().toISOString()
      await tx.cards.update(next)
      for (const event of events) await tx.events.append(event)
      return { card: next, events } satisfies MutationResult
    })
    publishCardHints(this.deps.eventBus, result.card, result.events)
    return result.card
  }

  /**
   * Moves or reorders a card. The position key is computed server-side from
   * neighbor ids re-read in-transaction, retrying once on a uniqueness
   * violation (ADR-006). Entering `waiting_parts_vendor` requires
   * waitingReason + expectedResumeAt; leaving it clears them. Non-cancel entry
   * into `done` sets `resolution = 'completed'` and notifies the requester.
   *
   * Policy checks: `card.reorder` (ready-lane gate) for same-lane moves,
   * `card.move` (transition graph + per-edge minRole when enforcement is on)
   * for cross-lane; a cross-lane move out of `done` is reopen semantics and
   * additionally consults the `reopen` action gate (workflow.md#terminal-states);
   * archived read-only; stale `expectedVersion` conflicts.
   * Audit events: `card.reordered` (same lane) or `card.status_changed` with
   * `wipLimitExceeded`/`clearedWaiting` markers.
   */
  async move(actor: Actor, cardId: string, rawInput: unknown): Promise<Card> {
    const input = moveCardInputSchema.parse(rawInput)
    const result = await runWithPositionRetry(
      this.deps.uow,
      async (tx) => {
        const card = requireFound(await tx.cards.findById(cardId), 'card')
        ensureNotArchived(card)
        const fromLane = await laneOfCard(tx, card)
        const toLane = await laneByKey(tx, card.boardId, input.toLane)
        const isReorder = toLane.id === fromLane.id
        const policy = await activePolicy(tx, card.boardId)
        decide(
          evaluatePolicy(
            actor,
            isReorder
              ? { type: 'card.reorder', lane: toLane.key }
              : { type: 'card.move', fromLane: fromLane.key, toLane: toLane.key },
            policy,
          ),
        )
        if (!isReorder && fromLane.key === 'done') {
          // Dragging out of done clears resolution — reopen semantics, so the
          // configured reopen action gate applies to drags too.
          decide(evaluatePolicy(actor, { type: 'card.reopen' }, policy))
        }
        ensureVersion(card, input.expectedVersion)

        const enteringWaiting = !isReorder && toLane.key === 'waiting_parts_vendor'
        const waitingFields = enteringWaiting
          ? waitingLaneEntrySchema.parse({
              waitingReason: input.waitingReason,
              expectedResumeAt: input.expectedResumeAt,
            })
          : null

        const readNeighbor = async (neighborId: string | null): Promise<Card | null> => {
          if (neighborId === null) return null
          const neighbor = await tx.cards.findById(neighborId)
          if (
            !neighbor ||
            neighbor.id === card.id ||
            neighbor.laneId !== toLane.id ||
            neighbor.archivedAt !== null
          ) {
            throw new ConflictError('stale move neighbors', card)
          }
          return neighbor
        }
        const prev = await readNeighbor(input.prevCardId)
        const next = await readNeighbor(input.nextCardId)
        const position = keyBetween(prev?.position ?? null, next?.position ?? null, card)

        const updated: Card = {
          ...card,
          laneId: toLane.id,
          position,
          version: card.version + 1,
          updatedAt: this.deps.clock.now().toISOString(),
        }

        let body: CardEventBody
        let completed = false
        if (isReorder) {
          body = {
            eventType: 'card.reordered',
            payload: {
              lane: toLane.key,
              prevCardId: input.prevCardId,
              nextCardId: input.nextCardId,
            },
          }
        } else {
          if (waitingFields) {
            updated.waitingReason = waitingFields.waitingReason
            updated.expectedResumeAt = waitingFields.expectedResumeAt
            updated.resumeAlertedAt = null
          }
          const clearedWaiting = fromLane.key === 'waiting_parts_vendor'
          if (clearedWaiting) {
            updated.waitingReason = null
            updated.expectedResumeAt = null
            updated.resumeAlertedAt = null
          }
          if (toLane.key === 'done') {
            updated.resolution = 'completed'
            completed = true
          }
          if (fromLane.key === 'done') {
            updated.resolution = null
          }
          let wipLimitExceeded = false
          if (toLane.wipLimit !== null) {
            // COUNT, not a row hydration: this runs inside the busiest write
            // transaction and soft limits leave lane size unbounded.
            const active = await tx.cards.countActiveByLane(toLane.id)
            wipLimitExceeded = active + 1 > toLane.wipLimit
          }
          body = {
            eventType: 'card.status_changed',
            payload: {
              fromLane: fromLane.key,
              toLane: toLane.key,
              ...(wipLimitExceeded ? { wipLimitExceeded: true as const } : {}),
              ...(clearedWaiting ? { clearedWaiting: true as const } : {}),
            },
          }
        }
        await tx.cards.update(updated)
        const event = makeEvent(this.deps.ids, this.deps.clock, actor, card.id, body)
        await tx.events.append(event)
        return { card: updated, events: [event], completed } satisfies MoveResult
      },
      (tx) => tx.cards.findById(cardId),
    )
    publishCardHints(this.deps.eventBus, result.card, result.events)
    if (result.completed) {
      // Best-effort and deliberately NOT awaited (NotifierPort contract): the
      // move is committed and broadcast, and nothing in the response depends
      // on the DM — a Slack outage must never hold the mover's request (or
      // their optimistic UI) hostage. Failures are swallowed here; the
      // adapter owns failure logging.
      void this.deps.notifier.cardCompleted(result.card).catch(() => {
        // Intentionally ignored — see above.
      })
    }
    return result.card
  }

  /**
   * Cancels a non-terminal card: moves it to the bottom of `done` with the
   * given cancel resolution. No requester notification is sent.
   *
   * Policy checks: `card.cancel` action gate; archived read-only; cards
   * already in `done` conflict (409); stale `expectedVersion` conflicts.
   * Audit events: a single `card.cancelled` (no `card.status_changed`).
   */
  async cancel(actor: Actor, cardId: string, rawInput: unknown): Promise<Card> {
    const input = cancelCardInputSchema.parse(rawInput)
    const result = await runWithPositionRetry(
      this.deps.uow,
      async (tx) => {
        const card = requireFound(await tx.cards.findById(cardId), 'card')
        ensureNotArchived(card)
        const fromLane = await laneOfCard(tx, card)
        if (fromLane.key === 'done') {
          throw new ConflictError('card is already terminal', card)
        }
        const policy = await activePolicy(tx, card.boardId)
        decide(evaluatePolicy(actor, { type: 'card.cancel' }, policy))
        ensureVersion(card, input.expectedVersion)

        const done = await laneByKey(tx, card.boardId, 'done')
        const bottom = await tx.cards.edgeOfLane(done.id, 'last')
        const updated: Card = {
          ...card,
          laneId: done.id,
          position: generateKeyBetween(bottom?.position ?? null, null),
          resolution: input.resolution,
          waitingReason: null,
          expectedResumeAt: null,
          resumeAlertedAt: null,
          version: card.version + 1,
          updatedAt: this.deps.clock.now().toISOString(),
        }
        await tx.cards.update(updated)
        const event = makeEvent(this.deps.ids, this.deps.clock, actor, card.id, {
          eventType: 'card.cancelled',
          payload: { resolution: input.resolution, fromLane: fromLane.key },
        })
        await tx.events.append(event)
        return { card: updated, events: [event] } satisfies MutationResult
      },
      (tx) => tx.cards.findById(cardId),
    )
    publishCardHints(this.deps.eventBus, result.card, result.events)
    return result.card
  }

  /**
   * Reopens a card in `done` (including cancelled and archived): clears
   * `resolution` and `archivedAt` and places it at the bottom of `ready`.
   *
   * Policy checks: `card.reopen` action gate plus the done→ready edge when
   * transition enforcement is on; cards outside `done` are an illegal
   * transition (422); stale `expectedVersion` conflicts.
   * Audit events: `card.reopened`.
   */
  async reopen(actor: Actor, cardId: string, rawInput: unknown): Promise<Card> {
    const input = reopenCardInputSchema.parse(rawInput)
    const result = await runWithPositionRetry(
      this.deps.uow,
      async (tx) => {
        const card = requireFound(await tx.cards.findById(cardId), 'card')
        const fromLane = await laneOfCard(tx, card)
        if (fromLane.key !== 'done') {
          decide({ allowed: false, kind: 'illegal-transition', from: fromLane.key, to: 'ready' })
        }
        const policy = await activePolicy(tx, card.boardId)
        decide(evaluatePolicy(actor, { type: 'card.reopen' }, policy))
        ensureVersion(card, input.expectedVersion)

        const ready = await laneByKey(tx, card.boardId, 'ready')
        const bottom = await tx.cards.edgeOfLane(ready.id, 'last')
        const updated: Card = {
          ...card,
          laneId: ready.id,
          position: generateKeyBetween(bottom?.position ?? null, null),
          resolution: null,
          archivedAt: null,
          version: card.version + 1,
          updatedAt: this.deps.clock.now().toISOString(),
        }
        await tx.cards.update(updated)
        const event = makeEvent(this.deps.ids, this.deps.clock, actor, card.id, {
          eventType: 'card.reopened',
          payload: { toLane: 'ready' },
        })
        await tx.events.append(event)
        return { card: updated, events: [event] } satisfies MutationResult
      },
      (tx) => tx.cards.findById(cardId),
    )
    publishCardHints(this.deps.eventBus, result.card, result.events)
    return result.card
  }

  /**
   * Archives every done card that entered Done more than DONE_ARCHIVAL_DAYS
   * ago (docs/product/workflow.md#archival) — the nightly job's work, owned
   * here so archival inherits the invariants every mutation gets: the
   * canonical event envelope and post-commit SSE hints (connected boards drop
   * archived cards without a reload). "Entered Done" is the newest matching
   * audit event, falling back to `updatedAt` for rows without a trail
   * (fixtures, imports). One transaction per card keeps every write-queue
   * slot small; idempotent — the candidate query excludes archived rows in
   * SQL, so a missed night simply catches up.
   *
   * Policy checks: none — `actor` is the system actor (jobs bypass policy).
   * Audit events: one `card.archived` per archived card.
   */
  async archiveExpired(actor: Actor): Promise<{ archived: number }> {
    const now = this.deps.clock.now()
    const cutoffIso = new Date(now.getTime() - DONE_ARCHIVAL_DAYS * 86_400_000).toISOString()
    const candidates = await this.deps.uow.read(async (tx) => {
      const done = await tx.lanes.findByKey(this.deps.boardId, 'done')
      if (done === null) return []
      // query() excludes archived rows by default — the scan stays
      // proportional to the LIVE done lane, not the unbounded archive.
      return tx.cards.query({ laneId: done.id })
    })

    let archived = 0
    for (const candidate of candidates) {
      const result = await this.deps.uow.run(async (tx) => {
        // Re-read inside the transaction: the card may have moved, changed,
        // or been archived since the candidate list was taken.
        const card = await tx.cards.findById(candidate.id)
        if (card?.archivedAt !== null || card.laneId !== candidate.laneId) {
          return null
        }
        if ((await enteredDoneAt(tx, card)) > cutoffIso) return null

        const nowIso = this.deps.clock.now().toISOString()
        const updated: Card = {
          ...card,
          archivedAt: nowIso,
          version: card.version + 1,
          updatedAt: nowIso,
        }
        await tx.cards.update(updated)
        const event = makeEvent(this.deps.ids, this.deps.clock, actor, card.id, {
          eventType: 'card.archived',
          payload: {},
        })
        await tx.events.append(event)
        return { card: updated, events: [event] } satisfies MutationResult
      })
      if (result !== null) {
        publishCardHints(this.deps.eventBus, result.card, result.events)
        archived += 1
      }
    }
    return { archived }
  }

  /**
   * Claims every overdue, un-alerted waiting-lane episode — the hourly aging
   * job's work (docs/product/workflow.md#waiting-on-parts--vendor-discipline),
   * owned here so the overdue rule (`isOverdueResume` over UTC days), the
   * at-most-once-per-episode claim, and the recipient policy (assignee first,
   * then every active supervisor, deduped; deactivated users never resolved)
   * are core business rules like `archiveExpired` — the server job only
   * schedules and delivers.
   *
   * One transaction claims every due episode and resolves its recipients
   * BEFORE any delivery is attempted: a crash between claim and DM costs one
   * alert, never a re-fire storm, and a restart re-derives everything from
   * persisted state.
   *
   * Policy checks: none — a scheduled system flow (like archiveExpired).
   * Audit events: none — `resumeAlertedAt` is delivery bookkeeping, not a
   * user-visible edit: no version bump, no updatedAt churn (data-model.md).
   */
  async claimOverdueWaitingAlerts(): Promise<{ card: Card; recipients: User[] }[]> {
    const now = this.deps.clock.now()
    const nowIso = now.toISOString()
    const today = utcDayOf(now)
    return this.deps.uow.run(async (tx) => {
      const lane = await tx.lanes.findByKey(this.deps.boardId, 'waiting_parts_vendor')
      if (lane === null) return []
      const overdue = (await tx.cards.query({ laneId: lane.id, overdueBefore: today })).filter(
        (card) => card.resumeAlertedAt === null,
      )
      if (overdue.length === 0) return []

      const supervisors = (await tx.userAccounts.list()).filter(
        (user) => user.role === 'supervisor' && user.isActive,
      )
      const alerts: { card: Card; recipients: User[] }[] = []
      for (const card of overdue) {
        // Assignee first, then supervisors, deduped (an assignee who is also
        // a supervisor gets one DM). Deactivated assignees get none.
        const recipients = new Map<string, User>()
        if (card.assigneeId !== null) {
          const assignee = await tx.users.findById(card.assigneeId)
          if (assignee?.isActive === true) recipients.set(assignee.id, assignee)
        }
        for (const supervisor of supervisors) recipients.set(supervisor.id, supervisor)

        const marked: Card = { ...card, resumeAlertedAt: nowIso }
        await tx.cards.update(marked)
        alerts.push({ card: marked, recipients: [...recipients.values()] })
      }
      return alerts
    })
  }

  /**
   * Raises the blocked flag (any lane); the card stays in its lane.
   *
   * Policy checks: read-scope rule only (no configurable gate); archived
   * read-only; already-blocked conflicts (409); stale `expectedVersion`
   * conflicts.
   * Audit events: `card.blocked` with the reason.
   */
  async block(actor: Actor, cardId: string, rawInput: unknown): Promise<Card> {
    const input = blockCardInputSchema.parse(rawInput)
    return this.setBlockedFlag(actor, cardId, input.expectedVersion, input.reason)
  }

  /**
   * Clears the blocked flag.
   *
   * Policy checks: read-scope rule only; archived read-only; not-blocked
   * conflicts (409); stale `expectedVersion` conflicts.
   * Audit events: `card.unblocked`.
   */
  async unblock(actor: Actor, cardId: string, rawInput: unknown): Promise<Card> {
    const input = unblockCardInputSchema.parse(rawInput)
    return this.setBlockedFlag(actor, cardId, input.expectedVersion, null)
  }

  /**
   * Assignees must be ACTIVE board users: a deactivated (offboarded) identity
   * or the hidden automation user is not a valid work target — the same rule
   * the Slack assignee field and the MCP reporter resolver enforce. Resolving
   * them exactly like unknown ids keeps the API from doubling as an
   * account-existence oracle.
   */
  private async requireAssignable(tx: TransactionContext, assigneeId: string): Promise<void> {
    const assignee = requireFound(await tx.users.findById(assigneeId), 'assignee')
    if (!assignee.isActive || assignee.id === this.deps.systemUserId) {
      throw new NotFoundError('assignee')
    }
  }

  private async setBlockedFlag(
    actor: Actor,
    cardId: string,
    expectedVersion: number,
    reason: string | null,
  ): Promise<Card> {
    const blocking = reason !== null
    const result = await this.deps.uow.run(async (tx) => {
      const card = requireFound(await tx.cards.findById(cardId), 'card')
      ensureNotArchived(card)
      const policy = await activePolicy(tx, card.boardId)
      decide(evaluatePolicy(actor, { type: blocking ? 'card.block' : 'card.unblock' }, policy))
      ensureVersion(card, expectedVersion)
      if (card.blocked === blocking) {
        throw new ConflictError(blocking ? 'card is already blocked' : 'card is not blocked', card)
      }

      const nowIso = this.deps.clock.now().toISOString()
      const updated: Card = {
        ...card,
        blocked: blocking,
        blockedReason: reason,
        blockedAt: blocking ? nowIso : null,
        version: card.version + 1,
        updatedAt: nowIso,
      }
      await tx.cards.update(updated)
      const event = makeEvent(this.deps.ids, this.deps.clock, actor, card.id, {
        eventType: blocking ? 'card.blocked' : 'card.unblocked',
        payload: reason !== null ? { reason } : {},
      })
      await tx.events.append(event)
      return { card: updated, events: [event] } satisfies MutationResult
    })
    publishCardHints(this.deps.eventBus, result.card, result.events)
    return result.card
  }
}

function changeOf(
  field: Exclude<AuditedCardField, 'tags'>,
  from: string | number | null,
  to: string | number | null,
): CardEventBody
function changeOf(field: 'tags', from: string[], to: string[]): CardEventBody
function changeOf(
  field: AuditedCardField,
  from: string | number | string[] | null,
  to: string | number | string[] | null,
): CardEventBody {
  return { eventType: 'card.field_changed', payload: { field, from, to } }
}

/**
 * When the card last entered Done, from its audit trail (fallback:
 * `updatedAt`). O(1): a card sitting in done arrived via a move
 * (`card.status_changed` into done) or a cancel (`card.cancelled`), and any
 * later lane change would have taken it out of done — so the newest event of
 * those two types is the arrival, read with LIMIT 1.
 */
async function enteredDoneAt(tx: TransactionContext, card: Card): Promise<string> {
  const newest = (
    await tx.events.listLatestByCard(card.id, 1, ['card.status_changed', 'card.cancelled'])
  ).at(0)
  if (newest?.eventType === 'card.cancelled') return newest.createdAt
  if (newest?.eventType === 'card.status_changed' && newest.payload.toLane === 'done') {
    return newest.createdAt
  }
  return card.updatedAt
}

/** Neighbors whose keys no longer bracket a valid gap are stale → 409. */
function keyBetween(prev: string | null, next: string | null, card: Card): string {
  try {
    return generateKeyBetween(prev, next)
  } catch {
    throw new ConflictError('stale move neighbors', card)
  }
}
