import {
  DEFAULT_BUSINESS_HOURS,
  DEFAULT_WAITING_REASONS,
  type BusinessHours,
} from '@rivian-kanban/core'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useApi } from './api-context.ts'
import { queryKeys } from './keys.ts'
import {
  locationsResponseSchema,
  policyResponseSchema,
  tagsResponseSchema,
  usersResponseSchema,
} from './schemas.ts'

/** Read the running build each time Preferences opens or the user refreshes. */
export function useAppVersion() {
  const api = useApi()
  return useQuery({
    queryKey: queryKeys.appVersion,
    queryFn: () => api.getVersion(),
    staleTime: 0,
    retry: false,
  })
}

/** Active users for avatar/name lookups (board cards, comments, history). */
export function useUsers() {
  const api = useApi()
  return useQuery({
    queryKey: queryKeys.users,
    queryFn: () => api.get('/users', usersResponseSchema),
  })
}

/** Async picker searches never linger — a stale roster snapshot is worthless. */
const USER_PICKER_STALE_MS = 30_000

/**
 * Async user-picker search (`GET /users/search?q=`) — the scalable path the
 * assignee/reporter pickers use so a 10k-user roster is never loaded whole.
 * Empty `q` returns the first page (server default 20), so the dropdown shows
 * something before the user types. Keeps the previous page's results while a
 * new query is in flight so the list doesn't blank on each keystroke.
 */
export function useUserSearch(q: string, enabled = true) {
  const api = useApi()
  return useQuery({
    queryKey: queryKeys.userSearch(q),
    queryFn: () => api.get('/users/search', usersResponseSchema, { query: { q } }),
    placeholderData: keepPreviousData,
    staleTime: USER_PICKER_STALE_MS,
    // The @-mention picker gates this to only fire while an `@token` is active.
    enabled,
  })
}

/**
 * Resolve an explicit set of already-selected ids to their picker shapes
 * (`GET /users/search?ids=`) so a card's assignee/reporter (or a filter pill)
 * renders its NAME even when that user isn't in the current search results —
 * including deactivated users the free-text search omits. Skipped for an empty
 * set (no request); unknown ids are simply absent from the result.
 */
export function useResolveUsers(ids: readonly string[]) {
  const api = useApi()
  return useQuery({
    queryKey: queryKeys.userResolve(ids),
    queryFn: () => api.get('/users/search', usersResponseSchema, { query: { ids: [...ids] } }),
    enabled: ids.length > 0,
    staleTime: USER_PICKER_STALE_MS,
  })
}

/** The active permission policy — drives drag/menu affordances (ADR-013). */
export function usePolicy(enabled = true) {
  const api = useApi()
  return useQuery({
    queryKey: queryKeys.policy,
    queryFn: () => api.get('/policy', policyResponseSchema),
    enabled,
  })
}

/** Includes retired definitions so existing cards can still display their names. */
export function useWaitingReasons() {
  return usePolicy().data?.waitingReasons ?? DEFAULT_WAITING_REASONS
}

/**
 * The board's admin-configured business hours (Settings → Permissions) that the
 * burn-down clock + overdue verdict count against — the default 09:00–17:00 until
 * the policy loads (or if it omits them).
 */
export function useBusinessHours(): BusinessHours {
  return usePolicy().data?.businessHours ?? DEFAULT_BUSINESS_HOURS
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
