import { createContext, useContext } from 'react'
import { type QueryClient } from '@tanstack/react-query'
import { type ApiClient } from './client.ts'

/**
 * The root api/queryClient pair, provided once at the shell boundary
 * (main.tsx / test renderers) and never replaced. Session, the board
 * catalog, board/group admin, and notifications must always read/write
 * through THIS pair regardless of where they're rendered — including inside
 * the board-scoped subtree (Settings, the header) — so a board switch can
 * never stall auth, the catalog, or the inbox.
 */
export interface GlobalApi {
  api: ApiClient
  queryClient: QueryClient
}

export const GlobalApiContext = createContext<GlobalApi | null>(null)

function useGlobalApiValue(): GlobalApi {
  const value = useContext(GlobalApiContext)
  if (value === null) throw new Error('useGlobalApi must be used within the app root')
  return value
}

export function useGlobalApi(): ApiClient {
  return useGlobalApiValue().api
}

export function useGlobalQueryClient(): QueryClient {
  return useGlobalApiValue().queryClient
}
