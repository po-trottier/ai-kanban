import { boardSchema, type Board, type BoardInput } from '@rivian-kanban/core'
import { useMutation, useQuery } from '@tanstack/react-query'
import { boardCatalogSchema } from '@rivian-kanban/core'
import { strings } from '../strings.ts'
import { useGlobalApi, useGlobalQueryClient } from './global-api-context.ts'
import { queryKeys } from './keys.ts'
import { notifyError, notifySuccess } from './notify.ts'

/** `GET /boards` — the boards the acting user may select, plus `canManage`.
 *  Global: the catalog decides the selection, so it can't itself depend on one. */
export function useBoardCatalog() {
  const api = useGlobalApi()
  return useQuery(
    {
      queryKey: queryKeys.boardCatalog,
      queryFn: () => api.get('/boards', boardCatalogSchema),
      // Poll fallback for a dead/closed SSE stream missing a board.updated hint.
      refetchInterval: 60_000,
    },
    useGlobalQueryClient(),
  )
}

export function useSetBoardPreference() {
  const api = useGlobalApi()
  const queryClient = useGlobalQueryClient()
  return useMutation(
    {
      mutationFn: (boardId: string | null) =>
        api.put('/boards/preference', boardCatalogSchema, { body: { boardId } }),
      onSuccess: (catalog) => {
        queryClient.setQueryData(queryKeys.boardCatalog, catalog)
        notifySuccess(strings.boards.preferenceSaved)
      },
      onError: notifyError,
    },
    queryClient,
  )
}

export function useCreateBoard() {
  const api = useGlobalApi()
  const queryClient = useGlobalQueryClient()
  return useMutation(
    {
      mutationFn: (input: BoardInput) => api.post('/boards', boardSchema, { body: input }),
      onSuccess: (board: Board) => {
        notifySuccess(strings.boards.created(board.name))
        void queryClient.invalidateQueries({ queryKey: queryKeys.boardCatalog })
      },
      onError: notifyError,
    },
    queryClient,
  )
}

export function useUpdateBoard() {
  const api = useGlobalApi()
  const queryClient = useGlobalQueryClient()
  return useMutation(
    {
      mutationFn: ({ boardId, input }: { boardId: string; input: BoardInput }) =>
        api.put(`/boards/${boardId}`, boardSchema, { body: input }),
      onSuccess: (board: Board) => {
        notifySuccess(strings.boards.updated(board.name))
        void queryClient.invalidateQueries({ queryKey: queryKeys.boardCatalog })
      },
      onError: notifyError,
    },
    queryClient,
  )
}

export function useDeleteBoard() {
  const api = useGlobalApi()
  const queryClient = useGlobalQueryClient()
  return useMutation(
    {
      mutationFn: (boardId: string) => api.deleteVoid(`/boards/${boardId}`),
      onSuccess: () => {
        notifySuccess(strings.boards.deleted)
        void queryClient.invalidateQueries({ queryKey: queryKeys.boardCatalog })
      },
      onError: notifyError,
    },
    queryClient,
  )
}
