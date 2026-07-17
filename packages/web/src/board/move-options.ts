import {
  roleAtLeast,
  type Card,
  type LaneKey,
  type PolicyActionGates,
  type PolicyDocument,
  type Role,
} from '@rivian-kanban/core'
import { extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge'
import { type Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/types'
import { type MoveIntent } from '../api/board-cache.ts'
import { type BoardResponse } from '../api/schemas.ts'

/**
 * Policy-driven affordances (ADR-013): with enforcement off anyone moves
 * anywhere; with it on, only graph edges whose role gate the user meets are
 * offered. The server re-validates regardless.
 */
export function canMoveToLane(
  policy: PolicyDocument,
  role: Role,
  from: LaneKey,
  to: LaneKey,
): boolean {
  if (from === to) return canReorderWithin(policy, role, from)
  if (!policy.transitionEnforcement) return true
  return policy.transitions.some(
    (edge) =>
      edge.from === from &&
      edge.to === to &&
      (edge.minRole === undefined || roleAtLeast(role, edge.minRole)),
  )
}

/** Within-lane reorder: always legal except the optional Ready-lane gate. */
function canReorderWithin(policy: PolicyDocument, role: Role, lane: LaneKey): boolean {
  return lane !== 'ready' || canPerformAction(policy, role, 'reorderReady')
}

/** Actions behind the optional policy gates (ADR-013: absent = any authenticated user). */
export function canPerformAction(
  policy: PolicyDocument,
  role: Role,
  action: keyof PolicyActionGates,
): boolean {
  const gate = policy.actionGates[action]
  return gate === undefined || roleAtLeast(role, gate)
}

export interface PositionChoice {
  /** Stable option id for selects. */
  value: string
  label: string
  prevCardId: string | null
  nextCardId: string | null
}

/**
 * Position options within a target lane: "First", then "After <card>" for
 * every card except the one being moved. Emits exactly the neighbor ids the
 * move API wants (ADR-006: the server computes the position key).
 */
export function positionChoices(
  laneCards: Card[],
  movingCardId: string,
  labels: { first: string; after: (title: string) => string },
): [PositionChoice, ...PositionChoice[]] {
  const others = laneCards.filter((card) => card.id !== movingCardId)
  const first: PositionChoice = {
    value: 'first',
    label: labels.first,
    prevCardId: null,
    nextCardId: others[0]?.id ?? null,
  }
  return [
    first,
    ...others.map((card, index) => ({
      value: `after:${card.id}`,
      label: labels.after(card.title),
      prevCardId: card.id,
      nextCardId: others[index + 1]?.id ?? null,
    })),
  ]
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
