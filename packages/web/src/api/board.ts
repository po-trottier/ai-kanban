import {
  cardSchema,
  type BlockCardInput,
  type BoardCard,
  type CancelCardInput,
  type Card,
  type CreateCardInput,
  type UpdateCardInput,
} from '@rivian-kanban/core'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { strings } from '../strings.ts'
import { useApi } from './api-context.ts'
import { applyMoveToBoard, type MoveIntent } from './board-cache.ts'
import { queryKeys } from './keys.ts'
import { notifyCardError, notifyError, notifySuccess } from './notify.ts'
import { movedToMessage } from './toast-messages.tsx'
import { boardResponseSchema, commentResponseSchema, type BoardResponse } from './schemas.ts'

export function useBoard() {
  const api = useApi()
  return useQuery({
    queryKey: queryKeys.board,
    queryFn: () => api.get('/board', boardResponseSchema),
  })
}

export interface MoveCardArgs {
  /** Only id + version are read (route + If-Match), so a board summary or the
   * detail panel's full Card both fit. */
  card: Pick<BoardCard, 'id' | 'version'>
  intent: MoveIntent
  /** Read to the live region after a successful menu-driven move (ADR-007). */
  announcement?: string
  /** Destination lane label, for the confirmation toast ("Card moved to Ready"). */
  laneLabel?: string
  /** Optional note posted as a card comment after a move into the waiting lane. */
  comment?: string
}

/**
 * `POST /cards/:id/move` with the official TanStack optimistic pattern:
 * onMutate snapshot → rollback onError → invalidate onSettled. A 409 rolls
 * back, refetches, and shows the non-blocking "card was just updated" toast
 * (ADR-012).
 */
export function useMoveCard(onMoved?: (args: MoveCardArgs) => void) {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ card, intent }: MoveCardArgs) =>
      api.post(`/cards/${String(card.id)}/move`, cardSchema, {
        body: intent,
        ifMatch: card.version,
      }),
    onMutate: async ({ card, intent }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.board })
      const previous = queryClient.getQueryData<BoardResponse>(queryKeys.board)
      if (previous !== undefined) {
        queryClient.setQueryData(queryKeys.board, applyMoveToBoard(previous, card.id, intent))
      }
      return { previous }
    },
    onError: (error, _args, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(queryKeys.board, context.previous)
      }
      notifyCardError(error)
    },
    onSuccess: (_card, args) => {
      // Every move confirms on-screen (a non-technical user needs reassurance
      // the action took) — naming the destination lane when we know it.
      notifySuccess(
        args.laneLabel === undefined ? strings.board.moved : movedToMessage(args.laneLabel),
      )
      onMoved?.(args)
      // Optional waiting-lane note → a card comment, best-effort: a failed post
      // never undoes the move that already succeeded.
      const note = args.comment?.trim()
      if (note !== undefined && note !== '') {
        void api
          .post(`/cards/${String(args.card.id)}/comments`, commentResponseSchema, {
            body: { body: note },
          })
          .then(() =>
            queryClient.invalidateQueries({
              queryKey: queryKeys.comments(String(args.card.id)),
            }),
          )
          .catch(notifyError)
      }
    },
    onSettled: (_card, _error, { card }) => {
      // A move appends a card.status_changed event and shifts the board: refetch
      // the board AND the moved card's detail + history, so an open detail panel's
      // History tab updates live instead of only on close/reopen (#88). The
      // detail-edit path already does this via invalidateCard; a move went
      // through only the board key before.
      void queryClient.invalidateQueries({ queryKey: queryKeys.board })
      const key = String(card.id)
      void queryClient.invalidateQueries({ queryKey: queryKeys.card(key) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.events(key) })
    },
  })
}

export function useCreateCard() {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateCardInput) => api.post('/cards', cardSchema, { body: input }),
    onSuccess: () => {
      notifySuccess(strings.newCard.created)
      void queryClient.invalidateQueries({ queryKey: queryKeys.board })
    },
    onError: notifyCardError,
  })
}

/** Field edits via `PATCH /cards/:id` (If-Match from the current version). */
export function useUpdateCard() {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      card,
      changes,
    }: {
      card: Card
      changes: Omit<UpdateCardInput, 'expectedVersion'>
    }) =>
      api.patch(`/cards/${String(card.id)}`, cardSchema, { body: changes, ifMatch: card.version }),
    onSuccess: (updated) => {
      notifySuccess(strings.detail.fieldsSaved)
      invalidateCard(queryClient, updated.id)
    },
    onError: (error, { card }) => {
      notifyCardError(error)
      invalidateCard(queryClient, card.id)
    },
  })
}

type CardAction =
  | { action: 'cancel'; body: Omit<CancelCardInput, 'expectedVersion'> }
  | { action: 'reopen' }
  | { action: 'archive' }
  | { action: 'block'; body: Omit<BlockCardInput, 'expectedVersion'> }
  | { action: 'unblock' }

/** The confirmation-toast copy for each card action (names the outcome). */
const ACTION_TOAST: Record<CardAction['action'], string> = {
  cancel: strings.card.cancelledToast,
  reopen: strings.card.reopenedToast,
  archive: strings.card.archivedToast,
  block: strings.card.blockedToast,
  unblock: strings.card.unblockedToast,
}

/** Cancel / reopen / block / unblock — explicit card actions, never drags. */
export function useCardAction() {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    // Only id + version are read (route + If-Match): the board summary and the
    // panel's full Card both fit, so both surfaces call one mutation.
    mutationFn: ({ card, ...action }: { card: Pick<BoardCard, 'id' | 'version'> } & CardAction) =>
      api.post(`/cards/${String(card.id)}/${action.action}`, cardSchema, {
        body: 'body' in action ? action.body : {},
        ifMatch: card.version,
      }),
    onSuccess: (updated, { action }) => {
      // Name the outcome and (for cancel/reopen) its destination lane so a
      // card that "vanishes" to Done is never a mystery (workflow.md).
      notifySuccess(ACTION_TOAST[action])
      invalidateCard(queryClient, updated.id)
    },
    onError: (error, { card }) => {
      notifyCardError(error)
      invalidateCard(queryClient, card.id)
    },
  })
}

function invalidateCard(queryClient: QueryClient, cardId: number): void {
  // Query keys are stringy (URL params are strings); the card id is an int.
  const key = String(cardId)
  void queryClient.invalidateQueries({ queryKey: queryKeys.board })
  void queryClient.invalidateQueries({ queryKey: queryKeys.card(key) })
  void queryClient.invalidateQueries({ queryKey: queryKeys.events(key) })
}
