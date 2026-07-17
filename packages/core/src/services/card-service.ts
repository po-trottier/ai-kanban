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
import { type ActorKind, type CardOrigin } from '../domain/constants.ts'
import { ConflictError } from '../domain/errors.ts'
import { type Actor, type Card } from '../domain/entities.ts'
import { type AuditedCardField, type CardEvent } from '../domain/events.ts'
import { evaluatePolicy } from '../policy/policy-engine.ts'
import { type UnitOfWork } from '../ports/repositories.ts'
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
        requireFound(await tx.users.findById(input.assigneeId), 'assignee')
      }
      if (input.locationId !== undefined) {
        requireFound(await tx.locations.findById(input.locationId), 'location')
      }

      const intake = await laneByKey(tx, this.deps.boardId, 'intake')
      const top = (await tx.cards.listByLane(intake.id)).at(0)
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
          requireFound(await tx.users.findById(input.assigneeId), 'assignee')
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
            const active = (await tx.cards.listByLane(toLane.id)).filter(
              (laneCard) => laneCard.archivedAt === null,
            )
            wipLimitExceeded = active.length + 1 > toLane.wipLimit
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
      try {
        await this.deps.notifier.cardCompleted(result.card)
      } catch {
        // Best-effort: the move is committed and broadcast — a notification
        // failure (e.g. Slack outage) must never surface as a command failure.
      }
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
        const bottom = (await tx.cards.listByLane(done.id)).at(-1)
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
        const bottom = (await tx.cards.listByLane(ready.id)).at(-1)
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

/** Neighbors whose keys no longer bracket a valid gap are stale → 409. */
function keyBetween(prev: string | null, next: string | null, card: Card): string {
  try {
    return generateKeyBetween(prev, next)
  } catch {
    throw new ConflictError('stale move neighbors', card)
  }
}
