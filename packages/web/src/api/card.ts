import {
  type AddCommentInput,
  type EditCommentInput,
  type LaneKey,
  type Priority,
} from '@rivian-kanban/core'
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useApi } from './api-context.ts'
import { API_BASE } from './client.ts'
import { queryKeys } from './keys.ts'
import { notifyError } from './notify.ts'
import {
  attachmentUploadResponseSchema,
  cardDetailResponseSchema,
  cardEventsPageSchema,
  cardsPageSchema,
  commentResponseSchema,
  commentsResponseSchema,
} from './schemas.ts'

export function useCardDetail(cardId: string) {
  const api = useApi()
  return useQuery({
    queryKey: queryKeys.card(cardId),
    queryFn: () => api.get(`/cards/${cardId}`, cardDetailResponseSchema),
  })
}

export function useComments(cardId: string) {
  const api = useApi()
  return useQuery({
    queryKey: queryKeys.comments(cardId),
    queryFn: () => api.get(`/cards/${cardId}/comments`, commentsResponseSchema),
  })
}

/** Audit history, oldest-first, cursor-paginated (`Load more`). */
export function useCardEvents(cardId: string) {
  const api = useApi()
  return useInfiniteQuery({
    queryKey: queryKeys.events(cardId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.get(`/cards/${cardId}/events`, cardEventsPageSchema, {
        query: { cursor: pageParam },
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  })
}

export interface CardSearchFilters {
  q: string
  includeArchived: boolean
  /** Restrict to archived cards only (the third archived-scope state). */
  archivedOnly?: boolean
  /** Advanced-search facets; an unset facet (null / empty) is omitted from the request. */
  priority?: Priority | null
  lane?: LaneKey | null
  /** Any-of tag match: a card with at least one of these tags. */
  tags?: string[]
  locationId?: string | null
}

/** `GET /cards` — the filterable card list (search + facets + include-archived), cursor-paginated. */
export function useCardSearch(filters: CardSearchFilters) {
  const api = useApi()
  return useInfiniteQuery({
    queryKey: queryKeys.cardList(filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.get('/cards', cardsPageSchema, {
        query: {
          q: filters.q === '' ? undefined : filters.q,
          includeArchived: filters.includeArchived ? true : undefined,
          archivedOnly: filters.archivedOnly ? true : undefined,
          priority: filters.priority ?? undefined,
          lane: filters.lane ?? undefined,
          tags: filters.tags && filters.tags.length > 0 ? filters.tags : undefined,
          locationId: filters.locationId ?? undefined,
          cursor: pageParam,
        },
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    // Archived search can be slow; keep the current results on screen while the
    // next query (a changed facet or query term) loads, rather than blanking to
    // a skeleton on every keystroke — the modal shows a spinner meanwhile.
    placeholderData: keepPreviousData,
  })
}

export function useAddComment(cardId: string) {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: AddCommentInput) =>
      api.post(`/cards/${cardId}/comments`, commentResponseSchema, { body: input }),
    onError: notifyError,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.comments(cardId) })
    },
  })
}

export function useEditComment(cardId: string) {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ commentId, input }: { commentId: string; input: EditCommentInput }) =>
      api.patch(`/comments/${commentId}`, commentResponseSchema, { body: input }),
    onError: notifyError,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.comments(cardId) })
    },
  })
}

export function useDeleteComment(cardId: string) {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (commentId: string) => api.deleteVoid(`/comments/${commentId}`),
    onError: notifyError,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.comments(cardId) })
    },
  })
}

/** Multipart upload — exactly one file per request in a part named `file`. */
export function useUploadAttachment(cardId: string) {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData()
      formData.append('file', file)
      return api.post(`/cards/${cardId}/attachments`, attachmentUploadResponseSchema, { formData })
    },
    // Surfaces the contract's routine failures: 413 too large, 415 bad MIME,
    // 409 attachment-limit (docs/architecture/rest-api.md#attachments).
    onError: notifyError,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.card(cardId) })
    },
  })
}

/**
 * Upload to a card whose id is only known at call time — the create form
 * gathers files before the card exists, then uploads each to the freshly
 * created card. Errors reject (no bound `onError`) so the caller can report a
 * bad file without aborting the rest.
 */
export function useUploadNewCardAttachment() {
  const api = useApi()
  return useMutation({
    mutationFn: ({ cardId, file }: { cardId: number; file: File }) => {
      const formData = new FormData()
      formData.append('file', file)
      return api.post(`/cards/${String(cardId)}/attachments`, attachmentUploadResponseSchema, {
        formData,
      })
    },
  })
}

export function useDeleteAttachment(cardId: string) {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (attachmentId: string) => api.deleteVoid(`/attachments/${attachmentId}`),
    onError: notifyError,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.card(cardId) })
    },
  })
}

/** Download URL for an attachment (used directly in `src`/`href`). */
export function attachmentUrl(attachmentId: string): string {
  return `${API_BASE}/attachments/${attachmentId}`
}
