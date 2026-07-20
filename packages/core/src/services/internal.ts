import { type Actor, type Card, type Comment, type Lane, type Tag } from '../domain/entities.ts'
import { type LaneKey } from '../domain/constants.ts'
import {
  ArchivedError,
  ConflictError,
  DuplicatePositionError,
  IllegalTransitionError,
  NotFoundError,
  PolicyDeniedError,
} from '../domain/errors.ts'
import { cardEventSchema, type CardEvent } from '../domain/events.ts'
import { type PolicyDocument } from '../domain/policy.ts'
import { type PolicyDecision } from '../policy/policy-engine.ts'
import { type TransactionContext, type UnitOfWork } from '../ports/repositories.ts'
import { type Clock, type EventBus, type IdGenerator } from '../ports/runtime.ts'

/** Internal helpers shared by the core services. Not part of the public API. */

export const DAY_MS = 86_400_000

export function requireFound<T>(value: T | null, resource: string): T {
  if (value === null) throw new NotFoundError(resource)
  return value
}

/** Archived cards are read-only except reopen (docs/product/workflow.md#terminal-states). */
export function ensureNotArchived(card: Card): void {
  if (card.archivedAt !== null) throw new ArchivedError()
}

/** Optimistic lock (ADR-012): stale expectedVersion → 409 with the current card. */
export function ensureVersion(card: Card, expectedVersion: number): void {
  if (card.version !== expectedVersion) {
    throw new ConflictError('stale expectedVersion', card)
  }
}

/** Turns a policy-engine decision into its typed domain error. */
export function decide(decision: PolicyDecision): void {
  if (decision.allowed) return
  if (decision.kind === 'illegal-transition') {
    throw new IllegalTransitionError(decision.from, decision.to)
  }
  throw new PolicyDeniedError(decision.rule)
}

/**
 * The active policy document. The structural seed always writes one
 * (data-model.md#seeding), so a missing row is a boot invariant violation
 * that must fail loudly — never fall back to a permissive default.
 */
export async function activePolicy(
  tx: TransactionContext,
  boardId: string,
): Promise<PolicyDocument> {
  return requireFound(await tx.policies.getActive(boardId), 'policy').config
}

export async function laneByKey(
  tx: TransactionContext,
  boardId: string,
  key: LaneKey,
): Promise<Lane> {
  return requireFound(await tx.lanes.findByKey(boardId, key), `lane ${key}`)
}

/**
 * The board's ENTRY lane — the first column by position (`listByBoard` is
 * position-ascending). Where new cards land and where a just-created draft may
 * still be discarded, regardless of the column's key. Columns are fully
 * user-defined now, so this replaces the hardcoded `intake` lookup — a board
 * always keeps at least one lane (the lane-admin delete guard).
 */
export async function firstLane(tx: TransactionContext, boardId: string): Promise<Lane> {
  const lanes = await tx.lanes.listByBoard(boardId)
  return requireFound(lanes[0] ?? null, 'lane')
}

export async function laneOfCard(tx: TransactionContext, card: Card): Promise<Lane> {
  const lanes = await tx.lanes.listByBoard(card.boardId)
  return requireFound(lanes.find((lane) => lane.id === card.laneId) ?? null, 'lane')
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/** The event-type-specific part of a CardEvent (everything but the envelope). */
export type CardEventBody = DistributiveOmit<
  CardEvent,
  'id' | 'cardId' | 'actorId' | 'actorKind' | 'createdAt'
>

/**
 * Builds an audit event envelope for `actor`; `actorId` is null for system
 * actors (data-model.md#card_events). Validated against the canonical schema.
 */
export function makeEvent(
  ids: IdGenerator,
  clock: Clock,
  actor: Actor,
  cardId: number,
  body: CardEventBody,
): CardEvent {
  return cardEventSchema.parse({
    ...body,
    id: ids.newId(),
    cardId,
    actorId: actor.kind === 'system' ? null : actor.id,
    actorKind: actor.kind,
    createdAt: clock.now().toISOString(),
  })
}

/**
 * Publishes one card-scoped SSE hint per committed mutation (ADR-008). Hints
 * are refetch triggers, not data: every event of one mutation shares the same
 * cardId/version, so the last event stands for all of them — a k-field update
 * must not k-multiply the fan-out (each hint reaches every SSE subscriber and
 * triggers a board refetch per connected client).
 */
export function publishCardHints(bus: EventBus, card: Card, events: readonly CardEvent[]): void {
  const last = events.at(-1)
  if (last === undefined) return
  bus.publish({
    type: last.eventType,
    cardId: card.id,
    version: card.version,
    eventId: last.id,
  })
}

/**
 * Runs the unit of work, retrying exactly once when the UNIQUE(laneId,
 * position) backstop fires so the retry re-reads fresh neighbors (ADR-006).
 * A second violation surfaces as a 409 conflict carrying the current card —
 * read via `currentCard` in a fresh read-only unit of work — so the server
 * can serialize it into the 409 body (rest-api.md, ADR-012).
 */
export async function runWithPositionRetry<T>(
  uow: UnitOfWork,
  fn: (tx: TransactionContext) => Promise<T>,
  currentCard?: (tx: TransactionContext) => Promise<Card | null>,
): Promise<T> {
  try {
    return await uow.run(fn)
  } catch (error) {
    if (!(error instanceof DuplicatePositionError)) throw error
    try {
      return await uow.run(fn)
    } catch (retryError) {
      if (retryError instanceof DuplicatePositionError) {
        const current = currentCard ? await uow.read(currentCard) : null
        throw new ConflictError('position conflict persisted after retry', current ?? undefined)
      }
      throw retryError
    }
  }
}

/**
 * Resolves tag names to Tag rows: case-insensitive match against existing tags
 * (case preserved), creating unknown ones; input de-duplicated case-insensitively.
 */
export async function resolveTags(
  tx: TransactionContext,
  ids: IdGenerator,
  names: readonly string[],
): Promise<Tag[]> {
  const resolved: Tag[] = []
  const seen = new Set<string>()
  for (const name of names) {
    const ci = name.toLowerCase()
    if (seen.has(ci)) continue
    seen.add(ci)
    const existing = await tx.tags.findByNameCi(name)
    if (existing) {
      resolved.push(existing)
    } else {
      const tag: Tag = { id: ids.newId(), name }
      await tx.tags.insert(tag)
      resolved.push(tag)
    }
  }
  return resolved
}

/**
 * Blanks the bodies of soft-deleted comments — deleted content never leaves
 * the server on ANY surface (rest-api.md#comments, `redactedCommentSchema`).
 * Shared by every core read that returns a comment thread.
 */
export function redactDeletedComments(thread: readonly Comment[]): Comment[] {
  return thread.map((comment) => (comment.deletedAt === null ? comment : { ...comment, body: '' }))
}

/** Case-insensitive set equality for tag names (tags match case-insensitively). */
export function sameTagSet(a: readonly string[], b: readonly string[]): boolean {
  const normalize = (names: readonly string[]) =>
    [...new Set(names.map((name) => name.toLowerCase()))].sort()
  const left = normalize(a)
  const right = normalize(b)
  return left.length === right.length && left.every((name, index) => name === right.at(index))
}
