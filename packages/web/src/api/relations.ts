import { type CreateCardRelationInput } from '@rivian-kanban/core'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { strings } from '../strings.ts'
import { useApi } from './api-context.ts'
import { queryKeys } from './keys.ts'
import { notifyError, notifySuccess } from './notify.ts'
import {
  cardRelationResponseSchema,
  cardRelationsResponseSchema,
  cardSearchResponseSchema,
} from './schemas.ts'

/** A card's typed relations (both directions), each resolved to the other card. */
export function useCardRelations(cardId: string) {
  const api = useApi()
  return useQuery({
    queryKey: queryKeys.relations(cardId),
    queryFn: () => api.get(`/cards/${cardId}/relations`, cardRelationsResponseSchema),
  })
}

/** `POST /cards/:id/relations` — link this card to another. */
export function useCreateRelation(cardId: string) {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateCardRelationInput) =>
      api.post(`/cards/${cardId}/relations`, cardRelationResponseSchema, { body: input }),
    onSuccess: () => {
      notifySuccess(strings.relations.added)
      void queryClient.invalidateQueries({ queryKey: queryKeys.relations(cardId) })
    },
    onError: notifyError,
  })
}

/** `DELETE /cards/:id/relations/:relationId`. */
export function useDeleteRelation(cardId: string) {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (relationId: string) => api.deleteVoid(`/cards/${cardId}/relations/${relationId}`),
    onSuccess: () => {
      notifySuccess(strings.relations.removed)
      void queryClient.invalidateQueries({ queryKey: queryKeys.relations(cardId) })
    },
    onError: notifyError,
  })
}

/**
 * Async card search for the relation-target picker — reuses `GET /cards?q=`
 * (title/description substring). An empty query returns the newest cards so the
 * picker shows something before typing; `keepPreviousData` avoids blanking the
 * list between keystrokes.
 */
export function useCardSearch(q: string) {
  const api = useApi()
  const params = new URLSearchParams({ limit: '10' })
  const trimmed = q.trim()
  if (trimmed !== '') params.set('q', trimmed)
  return useQuery({
    queryKey: queryKeys.cardSearch(trimmed),
    queryFn: () => api.get(`/cards?${params.toString()}`, cardSearchResponseSchema),
    placeholderData: keepPreviousData,
  })
}
