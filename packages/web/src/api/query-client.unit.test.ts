import { describe, expect, it } from 'vitest'
import { QueryObserver } from '@tanstack/react-query'
import { queryKeys } from './keys.ts'
import { ApiError } from './problem.ts'
import { createAppQueryClient, createScopedQueryClient } from './query-client.ts'
import { pushAction, undoLast } from '../undo/action-history.ts'

describe('createAppQueryClient', () => {
  it('clears the prior account catalog and inbox after a scoped 401 before another account signs in', async () => {
    // Arrange
    const queryClient = createAppQueryClient()
    const scoped = createScopedQueryClient(queryClient)
    queryClient.setQueryData(queryKeys.me, { id: 'admin-a' })
    const observer = new QueryObserver(queryClient, { queryKey: queryKeys.me, enabled: false })
    const unsubscribe = observer.subscribe(() => undefined)
    queryClient.setQueryData(queryKeys.boardCatalog, { items: ['private-board'], canManage: true })
    queryClient.setQueryData(queryKeys.notificationsUnread, { unread: 4 })
    localStorage.setItem('rivian-kanban:selected-board', 'private-board')
    pushAction({
      label: 'Private move',
      undo: () => Promise.resolve(),
      redo: () => Promise.resolve(),
    })
    // Act
    await scoped
      .fetchQuery({
        queryKey: queryKeys.board,
        queryFn: () => Promise.reject(new ApiError(401, { status: 401 })),
      })
      .catch(() => undefined)
    // Assert
    expect(observer.getCurrentResult().data).toBeNull()
    queryClient.setQueryData(queryKeys.me, { id: 'user-b' })
    expect(observer.getCurrentResult().data).toEqual({ id: 'user-b' })
    expect(queryClient.getQueryData(queryKeys.boardCatalog)).toBeUndefined()
    expect(queryClient.getQueryData(queryKeys.notificationsUnread)).toBeUndefined()
    expect(localStorage.getItem('rivian-kanban:selected-board')).toBeNull()
    expect(await undoLast()).toBeNull()
    unsubscribe()
  })
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
