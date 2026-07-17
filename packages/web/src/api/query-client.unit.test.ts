import { describe, expect, it } from 'vitest'
import { queryKeys } from './keys.ts'
import { ApiError } from './problem.ts'
import { createAppQueryClient } from './query-client.ts'

describe('createAppQueryClient', () => {
  it('resets the session query to null when any query hits a 401', async () => {
    // Arrange
    const queryClient = createAppQueryClient()
    queryClient.setQueryData(queryKeys.me, { id: 'someone' })
    // Act
    await queryClient
      .fetchQuery({
        queryKey: queryKeys.board,
        queryFn: () => Promise.reject(new ApiError(401, { status: 401 })),
      })
      .catch(() => undefined)
    // Assert
    expect(queryClient.getQueryData(queryKeys.me)).toBeNull()
  })

  it('leaves the session alone for non-auth failures', async () => {
    // Arrange
    const queryClient = createAppQueryClient()
    queryClient.setQueryData(queryKeys.me, { id: 'someone' })
    // Act
    await queryClient
      .fetchQuery({
        queryKey: queryKeys.board,
        queryFn: () => Promise.reject(new ApiError(500, { status: 500 })),
      })
      .catch(() => undefined)
    // Assert
    expect(queryClient.getQueryData(queryKeys.me)).toEqual({ id: 'someone' })
  })
})
