import { useQuery } from '@tanstack/react-query'
import { useApi } from './api-context.ts'
import { queryKeys } from './keys.ts'
import {
  locationsResponseSchema,
  policyResponseSchema,
  tagsResponseSchema,
  usersResponseSchema,
} from './schemas.ts'

/** Active users for pickers and avatar/name lookups. */
export function useUsers() {
  const api = useApi()
  return useQuery({
    queryKey: queryKeys.users,
    queryFn: () => api.get('/users', usersResponseSchema),
  })
}

/** The active permission policy — drives drag/menu affordances (ADR-013). */
export function usePolicy() {
  const api = useApi()
  return useQuery({
    queryKey: queryKeys.policy,
    queryFn: () => api.get('/policy', policyResponseSchema),
  })
}

export function useLocations() {
  const api = useApi()
  return useQuery({
    queryKey: queryKeys.locations,
    queryFn: () => api.get('/locations', locationsResponseSchema),
  })
}

/** Known tags for autocomplete. */
export function useTags() {
  const api = useApi()
  return useQuery({
    queryKey: queryKeys.tags,
    queryFn: () => api.get('/tags', tagsResponseSchema),
  })
}
