import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { strings } from '../strings.ts'
import { useApi } from './api-context.ts'
import { queryKeys } from './keys.ts'
import { notifyError, notifySuccess } from './notify.ts'
import { watchStateResponseSchema } from './schemas.ts'

/** Whether the current user watches this card. */
export function useCardWatch(cardId: string) {
  const api = useApi()
  return useQuery({
    queryKey: queryKeys.cardWatch(cardId),
    queryFn: () => api.get(`/cards/${cardId}/watch`, watchStateResponseSchema),
  })
}

/** `PUT /cards/:id/watch` — start watching (idempotent). */
export function useWatchCard(cardId: string) {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.put(`/cards/${cardId}/watch`, watchStateResponseSchema),
    onSuccess: () => {
      notifySuccess(strings.watch.watched)
      void queryClient.invalidateQueries({ queryKey: queryKeys.cardWatch(cardId) })
    },
    onError: notifyError,
  })
}

/** `DELETE /cards/:id/watch` — stop watching (idempotent). */
export function useUnwatchCard(cardId: string) {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.deleteVoid(`/cards/${cardId}/watch`),
    onSuccess: () => {
      notifySuccess(strings.watch.unwatched)
      void queryClient.invalidateQueries({ queryKey: queryKeys.cardWatch(cardId) })
    },
    onError: notifyError,
  })
}
