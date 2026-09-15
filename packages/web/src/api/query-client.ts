import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { queryKeys } from './keys.ts'
import { isUnauthorizedError } from './problem.ts'
import { clearStoredBoardSelection } from '../shell/board-scope.ts'
import { resetActionHistory } from '../undo/action-history.ts'

/**
 * App-wide QueryClient. Any 401 — query or mutation — resets the session
 * query, which sends `RequireAuth` back to the login page.
 */
export function createAppQueryClient(): QueryClient {
  const queryClient: QueryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 30_000 },
      mutations: { retry: false },
    },
    queryCache: new QueryCache({
      onError: (error) => {
        redirectOn401(queryClient, error)
      },
    }),
    mutationCache: new MutationCache({
      onError: (error) => {
        redirectOn401(queryClient, error)
      },
    }),
  })
  return queryClient
}

/**
 * A board-scoped QueryClient (multiple-boards): its own cache, isolated per
 * selected board, so switching boards discards the prior board's cached data
 * instead of leaking it. A 401 here still resets the OUTER client's session
 * query — auth is global, not board-scoped — so RequireAuth reacts regardless
 * of which client the failing request went through.
 */
export function createScopedQueryClient(outerQueryClient: QueryClient): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 30_000 },
      mutations: { retry: false },
    },
    queryCache: new QueryCache({
      onError: (error) => {
        redirectOn401(outerQueryClient, error)
      },
    }),
    mutationCache: new MutationCache({
      onError: (error) => {
        redirectOn401(outerQueryClient, error)
      },
    }),
  })
}

function redirectOn401(queryClient: QueryClient, error: unknown): void {
  if (!isUnauthorizedError(error)) return
  clearSessionData(queryClient)
  queryClient.setQueryData(queryKeys.me, null)
}

/** Preserve the observed session query so identity changes notify RequireAuth. */
export function clearSessionData(queryClient: QueryClient): void {
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== queryKeys.me[0] })
  queryClient.getMutationCache().clear()
  clearStoredBoardSelection()
  resetActionHistory()
}
