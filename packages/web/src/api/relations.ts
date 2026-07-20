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
 * Normalizes a relation-picker query so a card can be found by its work-order
 * NUMBER, a "#42" ticket ref, or a pasted card URL — not just its title. A
 * pasted `…/cards/42` or a `#42` collapses to the bare number `42` (the server
 * matches it against the card id); anything else passes through as a
 * title/description search term.
 */
export function cardSearchTerm(raw: string): string {
  const q = raw.trim()
  const fromUrl = /\/cards\/(\d+)/.exec(q)
  if (fromUrl !== null) return fromUrl[1] ?? q
  const fromHash = /^#(\d+)$/.exec(q)
  if (fromHash !== null) return fromHash[1] ?? q
  return q
}

/**
 * Async card search for the relation-target picker — reuses `GET /cards?q=`
 * (title/description, plus an exact work-order-number match server-side). An
 * empty query returns the newest cards so the picker shows something before
 * typing; `keepPreviousData` avoids blanking the list between keystrokes. The
 * query is normalized so a NUMBER, "#42", or a pasted card URL all resolve.
 */
export function useCardSearch(q: string) {
  const api = useApi()
  const params = new URLSearchParams({ limit: '10' })
  const term = cardSearchTerm(q)
  if (term !== '') params.set('q', term)
  return useQuery({
    queryKey: queryKeys.cardSearch(term),
    queryFn: () => api.get(`/cards?${params.toString()}`, cardSearchResponseSchema),
    placeholderData: keepPreviousData,
  })
}
