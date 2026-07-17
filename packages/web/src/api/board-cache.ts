import { type BoardCard, type LaneKey, type MoveCardInput } from '@rivian-kanban/core'
import { type BoardResponse } from './schemas.ts'

/** The client-side move intent: the core command minus the version (mapped to If-Match). */
export type MoveIntent = Omit<MoveCardInput, 'expectedVersion'>

/**
 * The one lane whose entry requires reason + resume date and whose exit clears
 * them (core `waitingLaneEntrySchema`) — shared so the optimistic cache and
 * the move funnel cannot drift.
 */
export function isWaitingLane(key: LaneKey): boolean {
  return key === 'waiting_parts_vendor'
}

/**
 * Applies a move optimistically to the cached board snapshot (official
 * TanStack onMutate pattern): removes the card from its lane, inserts it
 * between the intended neighbors, and recomputes soft WIP state. The server
 * remains the ordering authority — this is display-only until `onSettled`
 * refetches.
 */
export function applyMoveToBoard(
  board: BoardResponse,
  cardId: string,
  intent: MoveIntent,
): BoardResponse {
  const moving = board.lanes.flatMap((snapshot) => snapshot.cards).find((c) => c.id === cardId)
  if (moving === undefined) return board

  const targetLane = board.lanes.find((snapshot) => snapshot.lane.key === intent.toLane)
  if (targetLane === undefined) return board

  const movedCard: BoardCard = {
    ...moving,
    laneId: targetLane.lane.id,
    waitingReason: isWaitingLane(intent.toLane) ? (intent.waitingReason ?? null) : null,
    expectedResumeAt: isWaitingLane(intent.toLane) ? (intent.expectedResumeAt ?? null) : null,
  }

  return {
    lanes: board.lanes.map((snapshot) => {
      const withoutCard = snapshot.cards.filter((c) => c.id !== cardId)
      const cards =
        snapshot.lane.key === intent.toLane
          ? insertBetweenNeighbors(withoutCard, movedCard, intent.prevCardId, intent.nextCardId)
          : withoutCard
      return {
        ...snapshot,
        cards,
        wipLimitExceeded: snapshot.lane.wipLimit !== null && cards.length > snapshot.lane.wipLimit,
      }
    }),
  }
}

function insertBetweenNeighbors(
  cards: BoardCard[],
  card: BoardCard,
  prevCardId: string | null,
  nextCardId: string | null,
): BoardCard[] {
  if (prevCardId !== null) {
    const at = cards.findIndex((c) => c.id === prevCardId)
    if (at !== -1) return [...cards.slice(0, at + 1), card, ...cards.slice(at + 1)]
  }
  if (nextCardId !== null) {
    const at = cards.findIndex((c) => c.id === nextCardId)
    if (at !== -1) return [...cards.slice(0, at), card, ...cards.slice(at)]
  }
  // No surviving neighbor: top when explicitly first, else bottom.
  return prevCardId === null && nextCardId !== null ? [card, ...cards] : [...cards, card]
}

/** Where a card currently sits on the board (lane key lookup by lane id). */
export function laneKeyOfCard(
  board: BoardResponse,
  card: Pick<BoardCard, 'laneId'>,
): LaneKey | null {
  const lane = board.lanes.find((snapshot) => snapshot.lane.id === card.laneId)
  return lane?.lane.key ?? null
}
