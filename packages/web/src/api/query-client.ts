import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { queryKeys } from './keys.ts'
import { isUnauthorizedError } from './problem.ts'

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

function redirectOn401(queryClient: QueryClient, error: unknown): void {
  if (!isUnauthorizedError(error)) return
  queryClient.setQueryData(queryKeys.me, null)
}
