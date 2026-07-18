import {
  EMPTY_BOARD_FILTER,
  type BoardCard,
  type BoardFilter,
  type PolicyDocument,
  type Role,
} from '@rivian-kanban/core'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef } from 'react'
import { useCardAction, useMoveCard, type CardActionArgs, type MoveCardArgs } from '../api/board.ts'
import { laneKeyOfCard, restoreIntentForCard, type MoveIntent } from '../api/board-cache.ts'
import { queryKeys } from '../api/keys.ts'
import { type BoardResponse } from '../api/schemas.ts'
import { canMoveToLane, canPerformAction } from '../board/move-options.ts'
import { strings } from '../strings.ts'
import { pushAction, type UndoableAction } from './action-history.ts'

/** Raised inside an undo/redo closure when the inverse can no longer run (RBAC / off-board). */
class NotPermittedError extends Error {
  constructor() {
    super(strings.undo.cannotUndo)
    this.name = 'NotPermittedError'
  }
}

/** The live permission posture, read fresh at undo time (it can change). */
export interface UndoPolicy {
  policy: PolicyDocument | undefined
  role: Role
}

/** The card actions we make undoable (reopen is intentionally excluded — see below). */
export type UndoableActionArgs = Extract<
  CardActionArgs,
  { action: 'cancel' | 'block' | 'unblock' | 'archive' }
>

/**
 * Wraps the board's move + explicit-action mutations so every performed action
 * also records its inverse on the global undo/redo stack (ITEM 86), derived
 * from the PRE-mutation board snapshot. The wrappers are drop-in replacements
 * for `moveCard.mutate` / `cardAction.mutate`, so BoardPage keeps its flow and
 * simply routes through here.
 *
 * The inverse re-reads the CURRENT card (fresh optimistic version) from the live
 * board cache at undo time — the recorded snapshot's version is stale once the
 * forward action bumped it. When the card has left the board, or the inverse is
 * no longer permitted, the closure raises `NotPermittedError` so the keyboard
 * handler toasts "can't undo that" instead of firing a doomed request.
 *
 * `undoPolicy` is re-supplied every render and mirrored into a ref, so the undo
 * closures read the LATEST posture at undo time — a permission revoked after the
 * action still blocks the inverse.
 */
export function useUndoableBoard(
  undoPolicy: UndoPolicy,
  onMoved?: (args: MoveCardArgs) => void,
  filter: BoardFilter = EMPTY_BOARD_FILTER,
) {
  const queryClient = useQueryClient()
  const moveCard = useMoveCard(onMoved, filter)
  const cardAction = useCardAction()

  // Mirror the live posture so the (earlier-captured) undo closures dereference
  // the current value, not the one frozen when the action was recorded.
  const policyRef = useRef(undoPolicy)
  useEffect(() => {
    policyRef.current = undoPolicy
  }, [undoPolicy])

  /** The card as it currently sits in the board cache (fresh version), or null. */
  const currentCard = useCallback(
    (cardId: number): BoardCard | null => {
      const board = queryClient.getQueryData<BoardResponse>(queryKeys.boardQuery(filter))
      return board?.lanes.flatMap((lane) => lane.cards).find((c) => c.id === cardId) ?? null
    },
    [queryClient, filter],
  )

  /** Fires a move of the CURRENT card to `intent`, gated on the move being permitted now. */
  const fireMove = useCallback(
    async (cardId: number, intent: MoveIntent): Promise<void> => {
      const card = currentCard(cardId)
      const board = queryClient.getQueryData<BoardResponse>(queryKeys.boardQuery(filter))
      const from = board !== undefined && card !== null ? laneKeyOfCard(board, card) : null
      const { policy, role } = policyRef.current
      if (card === null || from === null || policy === undefined) throw new NotPermittedError()
      if (!canMoveToLane(policy, role, from, intent.toLane)) throw new NotPermittedError()
      await moveCard.mutateAsync({ card, intent })
    },
    [currentCard, moveCard, queryClient, filter],
  )

  /** Fires a card action on the CURRENT card for one undo/redo direction, gated when `gated` is set. */
  const runAction = useCallback(
    (cardId: number, build: (card: BoardCard) => CardActionArgs, gated?: 'reopen') =>
      async (): Promise<void> => {
        const card = currentCard(cardId)
        if (card === null) throw new NotPermittedError()
        if (gated !== undefined) {
          const { policy, role } = policyRef.current
          if (policy === undefined || !canPerformAction(policy, role, gated)) {
            throw new NotPermittedError()
          }
        }
        await cardAction.mutateAsync(build(card))
      },
    [cardAction, currentCard],
  )

  /**
   * Performs a move and records the inverse (back to the prior lane + neighbors)
   * from `before` — the board snapshot BEFORE this move. Redo re-applies the
   * original intent.
   */
  const moveWithUndo = useCallback(
    (args: MoveCardArgs, before: BoardResponse): void => {
      const restore = restoreIntentForCard(before, args.card.id)
      moveCard.mutate(args, {
        onSuccess: () => {
          // Only a real prior board position is undoable (a card that was
          // off-board before has nothing to restore to).
          if (restore === null) return
          pushAction({
            label: strings.undo.moveLabel,
            undo: () => fireMove(args.card.id, restore),
            redo: () => fireMove(args.card.id, args.intent),
          })
        },
      })
    },
    [moveCard, fireMove],
  )

  /**
   * Performs an explicit card action and records its inverse, from `beforeCard`
   * (the card BEFORE the action). Inverses — all reuse existing mutations:
   *   - cancel  → reopen  (redo: cancel again with the same resolution)
   *   - archive → reopen  (redo: archive again)
   *   - block   → unblock (redo: block again with the same reason)
   *   - unblock → block with the PRIOR reason (redo: unblock again)
   *
   * `reopen` is deliberately NOT undoable: its inverse must re-derive the
   * discarded terminal state (cancelled-with-which-resolution vs archived), and
   * reopen is itself the recovery path — undoing a recovery surprises more than
   * it helps. Skipped by omission.
   */
  const actionWithUndo = useCallback(
    (args: UndoableActionArgs, beforeCard: BoardCard): void => {
      cardAction.mutate(args, {
        onSuccess: () => {
          const entry = buildActionEntry(args, beforeCard, runAction)
          if (entry !== null) pushAction(entry)
        },
      })
    },
    [cardAction, runAction],
  )

  return { moveWithUndo, actionWithUndo }
}

type RunAction = (
  cardId: number,
  build: (card: BoardCard) => CardActionArgs,
  gated?: 'reopen',
) => () => Promise<void>

/** The undo/redo entry for one explicit card action, or null when it can't be inverted. */
function buildActionEntry(
  args: UndoableActionArgs,
  beforeCard: BoardCard,
  runAction: RunAction,
): UndoableAction | null {
  const id = beforeCard.id
  switch (args.action) {
    case 'cancel':
      return {
        label: strings.undo.cancelLabel,
        undo: runAction(id, (card) => ({ card, action: 'reopen' }), 'reopen'),
        redo: runAction(id, (card) => ({ card, action: 'cancel', body: args.body })),
      }
    case 'archive':
      return {
        label: strings.undo.archiveLabel,
        undo: runAction(id, (card) => ({ card, action: 'reopen' }), 'reopen'),
        redo: runAction(id, (card) => ({ card, action: 'archive' })),
      }
    case 'block':
      return {
        label: strings.undo.blockLabel,
        undo: runAction(id, (card) => ({ card, action: 'unblock' })),
        redo: runAction(id, (card) => ({ card, action: 'block', body: args.body })),
      }
    case 'unblock': {
      const reason = beforeCard.blockedReason
      if (reason === null) return null // no prior reason to restore the block from
      return {
        label: strings.undo.unblockLabel,
        undo: runAction(id, (card) => ({ card, action: 'block', body: { reason } })),
        redo: runAction(id, (card) => ({ card, action: 'unblock' })),
      }
    }
  }
}
