import {
  laneSchema,
  type LocationKind,
  type PolicyDocument,
  type Role,
  type TokenScope,
} from '@rivian-kanban/core'
import { notifications } from '@mantine/notifications'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { strings } from '../strings.ts'
import { useApi } from './api-context.ts'
import { queryKeys } from './keys.ts'
import { notifyError } from './notify.ts'
import {
  adminUserResponseSchema,
  createdServiceTokenSchema,
  locationSingleResponseSchema,
  policyResponseSchema,
  serviceTokensResponseSchema,
} from './schemas.ts'

export interface CreateUserInput {
  email: string
  displayName: string
  role: Role
}

/** `PATCH /users/:id` admin actions: role change, deactivation, password reset. */
export interface PatchUserInput {
  role?: Role
  isActive?: boolean
  resetPassword?: boolean
}

export function useCreateUser() {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateUserInput) =>
      api.post('/users', adminUserResponseSchema, { body: input }),
    onSuccess: () => {
      notifications.show({ message: strings.users.userCreated })
      void queryClient.invalidateQueries({ queryKey: queryKeys.users })
    },
    onError: notifyError,
  })
}

export function usePatchUser() {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ userId, input }: { userId: string; input: PatchUserInput }) =>
      api.patch(`/users/${userId}`, adminUserResponseSchema, { body: input }),
    onSuccess: () => {
      notifications.show({ message: strings.users.userUpdated })
      void queryClient.invalidateQueries({ queryKey: queryKeys.users })
    },
    onError: notifyError,
  })
}

export interface PatchLaneInput {
  label?: string
  wipLimit?: number | null
}

export function usePatchLane() {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ laneId, input }: { laneId: string; input: PatchLaneInput }) =>
      api.patch(`/lanes/${laneId}`, laneSchema, { body: input }),
    onSuccess: () => {
      notifications.show({ message: strings.lanes.saved })
      void queryClient.invalidateQueries({ queryKey: queryKeys.board })
    },
    onError: notifyError,
  })
}

/** `PUT /policy` — applies a new policy version (append-only history). */
export function usePutPolicy() {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (document: PolicyDocument) =>
      api.put('/policy', policyResponseSchema, { body: document }),
    onSuccess: () => {
      notifications.show({ message: strings.policy.saved })
      void queryClient.invalidateQueries({ queryKey: queryKeys.policy })
    },
    onError: notifyError,
  })
}

export interface CreateLocationInput {
  parentId: string | null
  kind: LocationKind
  name: string
}

export function useCreateLocation() {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateLocationInput) =>
      api.post('/locations', locationSingleResponseSchema, { body: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.locations })
    },
    onError: notifyError,
  })
}

export function useRenameLocation() {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ locationId, name }: { locationId: string; name: string }) =>
      api.patch(`/locations/${locationId}`, locationSingleResponseSchema, { body: { name } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.locations })
    },
    onError: notifyError,
  })
}

export function useDeleteLocation() {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (locationId: string) => api.deleteVoid(`/locations/${locationId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.locations })
    },
    onError: notifyError,
  })
}

export function useServiceTokens() {
  const api = useApi()
  return useQuery({
    queryKey: queryKeys.serviceTokens,
    queryFn: () => api.get('/service-tokens', serviceTokensResponseSchema),
  })
}

export interface CreateServiceTokenInput {
  name: string
  role: Role
  scope: TokenScope
}

export function useCreateServiceToken() {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateServiceTokenInput) =>
      api.post('/service-tokens', createdServiceTokenSchema, { body: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.serviceTokens })
    },
    onError: notifyError,
  })
}

export function useRevokeServiceToken() {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (tokenId: string) => api.deleteVoid(`/service-tokens/${tokenId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.serviceTokens })
    },
    onError: notifyError,
  })
}
