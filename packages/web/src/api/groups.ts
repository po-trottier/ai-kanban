import { groupSchema, type Group, type GroupInput } from '@rivian-kanban/core'
import { useMutation, useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { strings } from '../strings.ts'
import { useGlobalApi, useGlobalQueryClient } from './global-api-context.ts'
import { queryKeys } from './keys.ts'
import { notifyError, notifySuccess } from './notify.ts'

/** `GET /groups` — admin only (managePolicy). */
export function useGroups() {
  const api = useGlobalApi()
  return useQuery(
    {
      queryKey: queryKeys.groups,
      queryFn: () => api.get('/groups', z.array(groupSchema)),
    },
    useGlobalQueryClient(),
  )
}

export function useCreateGroup() {
  const api = useGlobalApi()
  const queryClient = useGlobalQueryClient()
  return useMutation(
    {
      mutationFn: (input: GroupInput) => api.post('/groups', groupSchema, { body: input }),
      onSuccess: (group: Group) => {
        notifySuccess(strings.groups.created(group.name))
        void queryClient.invalidateQueries({ queryKey: queryKeys.groups })
      },
      onError: notifyError,
    },
    queryClient,
  )
}

export function useUpdateGroup() {
  const api = useGlobalApi()
  const queryClient = useGlobalQueryClient()
  return useMutation(
    {
      mutationFn: ({ groupId, input }: { groupId: string; input: GroupInput }) =>
        api.put(`/groups/${groupId}`, groupSchema, { body: input }),
      onSuccess: (group: Group) => {
        notifySuccess(strings.groups.updated(group.name))
        void queryClient.invalidateQueries({ queryKey: queryKeys.groups })
      },
      onError: notifyError,
    },
    queryClient,
  )
}

export function useDeleteGroup() {
  const api = useGlobalApi()
  const queryClient = useGlobalQueryClient()
  return useMutation(
    {
      mutationFn: (groupId: string) => api.deleteVoid(`/groups/${groupId}`),
      onSuccess: () => {
        notifySuccess(strings.groups.deleted)
        void queryClient.invalidateQueries({ queryKey: queryKeys.groups })
      },
      onError: notifyError,
    },
    queryClient,
  )
}
