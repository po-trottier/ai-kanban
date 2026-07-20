import {
  EMPTY_BOARD_FILTER,
  cardSchema,
  type BlockCardInput,
  type BoardCard,
  type BoardFilter,
  type CancelCardInput,
  type Card,
  type CreateCardInput,
  type UpdateCardInput,
} from '@rivian-kanban/core'
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { strings } from '../strings.ts'
import { useApi } from './api-context.ts'
import { applyMoveToBoard, type MoveIntent } from './board-cache.ts'
import { queryKeys } from './keys.ts'
import { notifyCardError, notifyError, notifySuccess } from './notify.ts'
import { movedToMessage } from './toast-messages.tsx'
import {
  boardResponseSchema,
  commentResponseSchema,
  type BoardResponse,
  type CardDetailResponse,
} from './schemas.ts'

/**
 * The board, narrowed by a `BoardFilter`. Each filter is its own query (keyed
 * by the filter under the shared `board` prefix, so any board invalidation —
 * SSE, a move — refetches whichever filter is mounted). The empty filter takes
 * the hot, cached `GET /board` path (today's unfiltered board); a non-empty
 * filter posts to `POST /board/query`. The board response is identical either
 * way, so the whole board/drag/move pipeline is unchanged downstream.
 */
export function useBoard(filter: BoardFilter = EMPTY_BOARD_FILTER) {
  const api = useApi()
  const isEmpty = isEmptyFilter(filter)
  return useQuery({
    queryKey: queryKeys.boardQuery(filter),
    queryFn: () =>
      isEmpty
        ? api.get('/board', boardResponseSchema)
        : api.post('/board/query', boardResponseSchema, { body: filter }),
    // Keep the previous filter's board on screen while the next one loads, so a
    // filter change shows the old board dimmed + a skeleton rather than blanking
    // the whole page (isPlaceholderData marks the round-trip in progress).
    placeholderData: keepPreviousData,
  })
}

/** True when a filter narrows nothing (the empty filter → today's full board). */
export function isEmptyFilter(filter: BoardFilter): boolean {
  return (
    filter.priorities.length === 0 &&
    filter.assigneeIds.length === 0 &&
    filter.reporterIds.length === 0 &&
    filter.tags.length === 0 &&
    filter.locationIds.length === 0 &&
    filter.scope === 'active' &&
    filter.q.trim() === '' &&
    !filter.overdue
  )
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
 *
 * `filter` names the board variant currently mounted, so the optimistic
 * snapshot reads/writes the exact filtered board cache (drag/move stays
 * optimistic on a filtered board). onSettled still invalidates the `board`
 * PREFIX, refetching whichever filter is showing.
 */
export function useMoveCard(
  onMoved?: (args: MoveCardArgs) => void,
  filter: BoardFilter = EMPTY_BOARD_FILTER,
) {
  const api = useApi()
  const queryClient = useQueryClient()
  const boardKey = queryKeys.boardQuery(filter)
  return useMutation({
    mutationFn: ({ card, intent }: MoveCardArgs) =>
      api.post(`/cards/${String(card.id)}/move`, cardSchema, {
        body: intent,
        ifMatch: card.version,
      }),
    onMutate: async ({ card, intent }) => {
      await queryClient.cancelQueries({ queryKey: boardKey })
      const previous = queryClient.getQueryData<BoardResponse>(boardKey)
      if (previous !== undefined) {
        queryClient.setQueryData(boardKey, applyMoveToBoard(previous, card.id, intent))
      }
      return { previous }
    },
    onError: (error, _args, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(boardKey, context.previous)
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
      // A new card can carry a new free-form tag, so refresh the tags list that
      // feeds the filter-bar Tags facet and the card's tag autocomplete (the
      // edit path already does this via invalidateCard).
      void queryClient.invalidateQueries({ queryKey: queryKeys.tags })
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
      /**
       * Suppresses the success toast — the create view auto-saves on every
       * debounced field edit, so a toast per keystroke-pause would be noise.
       */
      silent?: boolean
    }) =>
      api.patch(`/cards/${String(card.id)}`, cardSchema, { body: changes, ifMatch: card.version }),
    onSuccess: (updated, { silent }) => {
      // Write the freshly-bumped card straight into the detail cache so a rapid
      // NEXT save (the create view's auto-save) reads the new version at once
      // rather than racing the invalidation refetch — otherwise the second
      // PATCH sends a stale If-Match and 409s. keepDirtyValues in CardDetailsForm
      // preserves any in-progress edit across the re-seed, so the detail panel's
      // explicit-Save flow is unaffected.
      queryClient.setQueryData<CardDetailResponse>(queryKeys.card(String(updated.id)), (old) =>
        old ? { ...old, card: updated } : old,
      )
      if (silent !== true) notifySuccess(strings.detail.fieldsSaved)
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

/** The `useCardAction` mutate argument: the target card (id + version) plus one action. */
export type CardActionArgs = { card: Pick<BoardCard, 'id' | 'version'> } & CardAction

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
    mutationFn: ({ card, ...action }: CardActionArgs) =>
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
  // A card edit can mint a new free-form tag, so refresh the tags list that
  // feeds the filter-bar Tags facet and the card's tag autocomplete.
  void queryClient.invalidateQueries({ queryKey: queryKeys.tags })
}
