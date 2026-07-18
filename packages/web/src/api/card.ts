import { type AddCommentInput, type EditCommentInput } from '@rivian-kanban/core'
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { useApi } from './api-context.ts'
import { API_BASE } from './client.ts'
import { queryKeys } from './keys.ts'
import { notifyError } from './notify.ts'
import {
  attachmentUploadResponseSchema,
  cardDetailResponseSchema,
  cardEventsPageSchema,
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

/**
 * Every comment write appends a card event (comment.added/edited/deleted —
 * comment-service.ts), so refetch BOTH the thread and the history: an open
 * detail panel's History tab must update live, not only on close/reopen (#88).
 */
function invalidateThreadAndHistory(queryClient: QueryClient, cardId: string): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.comments(cardId) })
  void queryClient.invalidateQueries({ queryKey: queryKeys.events(cardId) })
}

/**
 * Attachment writes append a card event too (attachment.added/removed —
 * attachment-service.ts) and live on the detail payload, so refetch the detail
 * AND the history — matching the SSE attachment-hint fan-out (sse.ts) so the
 * open panel's History tab is live (#88).
 */
function invalidateDetailAndHistory(queryClient: QueryClient, cardId: string): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.card(cardId) })
  void queryClient.invalidateQueries({ queryKey: queryKeys.events(cardId) })
}

export function useAddComment(cardId: string) {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: AddCommentInput) =>
      api.post(`/cards/${cardId}/comments`, commentResponseSchema, { body: input }),
    onError: notifyError,
    onSettled: () => {
      invalidateThreadAndHistory(queryClient, cardId)
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
      invalidateThreadAndHistory(queryClient, cardId)
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
      invalidateThreadAndHistory(queryClient, cardId)
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
      invalidateDetailAndHistory(queryClient, cardId)
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
      invalidateDetailAndHistory(queryClient, cardId)
    },
  })
}

/** Download URL for an attachment (used directly in `src`/`href`). */
export function attachmentUrl(attachmentId: string): string {
  return `${API_BASE}/attachments/${attachmentId}`
}
