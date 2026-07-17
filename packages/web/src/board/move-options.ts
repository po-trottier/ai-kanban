import {
  evaluatePolicy,
  type Actor,
  type BoardCard,
  type LaneKey,
  type PolicyAction,
  type PolicyActionGates,
  type PolicyDocument,
  type Role,
} from '@rivian-kanban/core'
import { extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge'
import { type Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/types'
import { type MoveIntent } from '../api/board-cache.ts'
import { type BoardResponse } from '../api/schemas.ts'

/**
 * Policy-driven affordances (ADR-013), answered by core's `evaluatePolicy` —
 * the SAME engine the server re-validates with, so what the UI offers and
 * what the server accepts cannot drift. The engine takes an Actor but these
 * affordances depend only on the role; the fixed id pair below models the
 * acting user versus another author for the delete-others gates (the
 * author-always-may branch is decided at the call site, which knows real ids).
 */
const SELF_ID = '00000000-0000-4000-8000-000000000001'
const OTHER_AUTHOR_ID = '00000000-0000-4000-8000-000000000002'

function allowed(role: Role, action: PolicyAction, policy: PolicyDocument): boolean {
  const actor: Actor = { kind: 'user', id: SELF_ID, role }
  return evaluatePolicy(actor, action, policy).allowed
}

/**
 * Whether a card may be offered lane→lane (drag targets, the move modal).
 * Mirrors CardService.move exactly: reorder within a lane, the transition
 * graph for cross-lane moves, and — because a move out of `done` is reopen
 * semantics on the server — the reopen action for drags out of done.
 */
export function canMoveToLane(
  policy: PolicyDocument,
  role: Role,
  from: LaneKey,
  to: LaneKey,
): boolean {
  if (from === to) return allowed(role, { type: 'card.reorder', lane: from }, policy)
  if (from === 'done' && !allowed(role, { type: 'card.reopen' }, policy)) return false
  return allowed(role, { type: 'card.move', fromLane: from, toLane: to }, policy)
}

/** The policy action each configurable gate protects (ADR-013). */
const GATE_ACTIONS: Record<keyof PolicyActionGates, PolicyAction> = {
  cancel: { type: 'card.cancel' },
  reopen: { type: 'card.reopen' },
  archive: { type: 'card.archive' },
  reorderReady: { type: 'card.reorder', lane: 'ready' },
  deleteOthersComments: { type: 'comment.delete', authorId: OTHER_AUTHOR_ID },
  deleteOthersAttachments: { type: 'attachment.remove', uploaderId: OTHER_AUTHOR_ID },
}

/** Actions behind the optional policy gates (ADR-013: absent = any authenticated user). */
export function canPerformAction(
  policy: PolicyDocument,
  role: Role,
  action: keyof PolicyActionGates,
): boolean {
  return allowed(role, GATE_ACTIONS[action], policy)
}

export interface PositionChoice {
  /** Stable option id for selects. */
  value: string
  label: string
  prevCardId: string | null
  nextCardId: string | null
}

/**
 * Position options within a target lane (ITEM 2): a clear "First" (top) and
 * "Last" (bottom), plus a per-card "After <card>" for precise MIDDLE placement.
 * The bottom is a named "Last" instead of the confusing "After <last card>", so
 * an empty/single-card lane never forces a user to reason about neighbors:
 *
 * - empty lane  → a single "Only card" option (no redundant First + Last);
 * - one card    → "First" and "Last" (top or bottom, no middle);
 * - N cards     → "First", "After <card>" for the first N−1, then "Last".
 *
 * Emits exactly the neighbor ids the move API wants (ADR-006: the server
 * computes the position key from prev/next).
 */
export function positionChoices(
  // Only id + title are read, so both a board summary and a full card fit.
  laneCards: Pick<BoardCard, 'id' | 'title'>[],
  movingCardId: string,
  labels: { first: string; last: string; only: string; after: (title: string) => string },
): [PositionChoice, ...PositionChoice[]] {
  const others = laneCards.filter((card) => card.id !== movingCardId)
  // Empty target lane: one unambiguous option — the card simply lands here.
  if (others.length === 0) {
    return [{ value: 'first', label: labels.only, prevCardId: null, nextCardId: null }]
  }
  const first: PositionChoice = {
    value: 'first',
    label: labels.first,
    prevCardId: null,
    nextCardId: others[0]?.id ?? null,
  }
  const last: PositionChoice = {
    value: 'last',
    label: labels.last,
    prevCardId: others[others.length - 1]?.id ?? null,
    nextCardId: null,
  }
  // "After <card>" only for the true middle gaps — the first N−1 cards; the
  // gap after the last card is the named "Last" above.
  const middle: PositionChoice[] = others.slice(0, -1).map((card, index) => ({
    value: `after:${card.id}`,
    label: labels.after(card.title),
    prevCardId: card.id,
    nextCardId: others[index + 1]?.id ?? null,
  }))
  return [first, ...middle, last]
}

export interface DropTarget {
  laneKey: LaneKey
  /** Card the pointer is over, with the closest edge; absent = empty lane area. */
  overCardId?: string
  edge?: Edge
}

/** A dropped-on target record from the Pragmatic DnD monitor. */
export interface DroppedOn {
  data: Record<string | symbol, unknown>
}

/**
 * Picks the effective target from a drop-target stack: the inner-most card
 * target (with its closest edge) wins over the enclosing lane target.
 */
export function resolveDropTarget(dropTargets: DroppedOn[]): DropTarget | null {
  const cardTarget = dropTargets.find((entry) => typeof entry.data.cardId === 'string')
  if (cardTarget !== undefined) {
    const edge = extractClosestEdge(cardTarget.data)
    return {
      laneKey: cardTarget.data.laneKey as LaneKey,
      overCardId: cardTarget.data.cardId as string,
      ...(edge === null ? {} : { edge }),
    }
  }
  const laneTarget = dropTargets.find((entry) => typeof entry.data.laneKey === 'string')
  if (laneTarget !== undefined) return { laneKey: laneTarget.data.laneKey as LaneKey }
  return null
}

/**
 * Translates a drag-and-drop location into the neighbor-id move command.
 * Returns null for a no-op drop (own footprint or same position).
 */
export function moveIntentFromDrop(
  board: BoardResponse,
  cardId: string,
  target: DropTarget,
): MoveIntent | null {
  // Dropping a card onto itself (the change-of-mind gesture) is always a no-op.
  if (target.overCardId === cardId) return null
  const lane = board.lanes.find((snapshot) => snapshot.lane.key === target.laneKey)
  if (lane === undefined) return null
  const others = lane.cards.filter((card) => card.id !== cardId)

  let index = others.length // default: end of lane
  if (target.overCardId !== undefined) {
    const at = others.findIndex((card) => card.id === target.overCardId)
    if (at !== -1) index = target.edge === 'top' ? at : at + 1
  }

  const intent: MoveIntent = {
    toLane: target.laneKey,
    prevCardId: others[index - 1]?.id ?? null,
    nextCardId: others[index]?.id ?? null,
  }
  return isSamePosition(board, cardId, intent) ? null : intent
}

/** True when the intent leaves the card exactly between its current neighbors. */
export function isSamePosition(board: BoardResponse, cardId: string, intent: MoveIntent): boolean {
  const lane = board.lanes.find((snapshot) => snapshot.lane.key === intent.toLane)
  if (lane === undefined) return false
  const current = lane.cards.findIndex((card) => card.id === cardId)
  if (current === -1) return false
  const prevNow = lane.cards[current - 1]?.id ?? null
  const nextNow = lane.cards[current + 1]?.id ?? null
  return intent.prevCardId === prevNow && intent.nextCardId === nextNow
}

/**
 * Lane label + 1-based landing position for a move intent — the live-region
 * announcement for drag drops (menu moves compute theirs in the modal).
 */
export function dropPosition(
  board: BoardResponse,
  cardId: string,
  intent: MoveIntent,
): { laneLabel: string; position: number } | null {
  const lane = board.lanes.find((snapshot) => snapshot.lane.key === intent.toLane)
  if (lane === undefined) return null
  const others = lane.cards.filter((card) => card.id !== cardId)
  const position =
    intent.prevCardId === null ? 1 : others.findIndex((card) => card.id === intent.prevCardId) + 2
  return { laneLabel: lane.lane.label, position }
}
