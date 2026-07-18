import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { makeCard } from '../test/fixtures.ts'
import { createFakeFetch } from '../test/fake-fetch.ts'
import { ApiClient } from './client.ts'
import { ApiContext } from './api-context.ts'
import { useMoveCard } from './board.ts'
import { queryKeys } from './keys.ts'

/** Providers for a hook under test: injected fake API + a spy-able QueryClient. */
function wrapperOf(client: ApiClient, queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ApiContext.Provider value={client}>{children}</ApiContext.Provider>
      </QueryClientProvider>
    )
  }
}

describe('useMoveCard', () => {
  it('invalidates the moved card history so an open History tab updates live', async () => {
    // Arrange — a move appends a card.status_changed event, so its history must
    // refetch (#88); before the fix the move touched only the board key.
    const card = makeCard('ready', { version: 4 })
    const moved = makeCard('in_progress', { id: card.id, version: 5 })
    const fake = createFakeFetch({ [`POST /api/v1/cards/${String(card.id)}/move`]: moved })
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useMoveCard(), {
      wrapper: wrapperOf(new ApiClient(fake.fetch), queryClient),
    })
    // Act
    result.current.mutate({
      card,
      intent: { toLane: 'in_progress', prevCardId: null, nextCardId: null },
    })
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    // Assert — the events query for the moved card was invalidated.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.events(String(card.id)) })
  })
})
