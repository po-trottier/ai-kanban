import {
  cardSchema,
  type BlockCardInput,
  type CancelCardInput,
  type Card,
  type CreateCardInput,
  type UpdateCardInput,
} from '@rivian-kanban/core'
import { notifications } from '@mantine/notifications'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { strings } from '../strings.ts'
import { useApi } from './api-context.ts'
import { applyMoveToBoard, type MoveIntent } from './board-cache.ts'
import { queryKeys } from './keys.ts'
import { notifyCardError } from './notify.ts'
import { boardResponseSchema, type BoardResponse } from './schemas.ts'

export function useBoard() {
  const api = useApi()
  return useQuery({
    queryKey: queryKeys.board,
    queryFn: () => api.get('/board', boardResponseSchema),
  })
}

export interface MoveCardArgs {
  card: Card
  intent: MoveIntent
  /** Read to the live region after a successful menu-driven move (ADR-007). */
  announcement?: string
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
      api.post(`/cards/${card.id}/move`, cardSchema, { body: intent, ifMatch: card.version }),
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
      onMoved?.(args)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.board })
    },
  })
}

export function useCreateCard() {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateCardInput) => api.post('/cards', cardSchema, { body: input }),
    onSuccess: () => {
      notifications.show({ message: strings.newCard.created })
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
    }) => api.patch(`/cards/${card.id}`, cardSchema, { body: changes, ifMatch: card.version }),
    onSuccess: (updated) => {
      notifications.show({ message: strings.detail.fieldsSaved })
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
  | { action: 'block'; body: Omit<BlockCardInput, 'expectedVersion'> }
  | { action: 'unblock' }

/** Cancel / reopen / block / unblock — explicit card actions, never drags. */
export function useCardAction() {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ card, ...action }: { card: Card } & CardAction) =>
      api.post(`/cards/${card.id}/${action.action}`, cardSchema, {
        body: 'body' in action ? action.body : {},
        ifMatch: card.version,
      }),
    onSuccess: (updated) => {
      invalidateCard(queryClient, updated.id)
    },
    onError: (error, { card }) => {
      notifyCardError(error)
      invalidateCard(queryClient, card.id)
    },
  })
}

function invalidateCard(queryClient: QueryClient, cardId: string): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.board })
  void queryClient.invalidateQueries({ queryKey: queryKeys.card(cardId) })
  void queryClient.invalidateQueries({ queryKey: queryKeys.events(cardId) })
}
