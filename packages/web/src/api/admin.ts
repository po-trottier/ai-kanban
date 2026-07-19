import {
  laneSchema,
  type CreateLaneInput,
  type CreateLocationInput,
  type CreateServiceTokenInput,
  type CreateUserInput,
  type PolicyDocument,
  type UpdateLaneInput,
  type UpdateUserInput,
} from '@rivian-kanban/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { strings } from '../strings.ts'
import { useApi } from './api-context.ts'
import { queryKeys } from './keys.ts'
import { notifyError, notifySuccess } from './notify.ts'
import { isConflictError } from './problem.ts'
import {
  adminUserResponseSchema,
  createdServiceTokenSchema,
  locationSingleResponseSchema,
  policyResponseSchema,
  serviceTokensResponseSchema,
} from './schemas.ts'

// Admin command inputs are core's schemas (single-schema rule): the forms
// send exactly the shape the server parses — same field roster, same caps.

export function useCreateUser() {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateUserInput) =>
      api.post('/users', adminUserResponseSchema, { body: input }),
    onSuccess: () => {
      notifySuccess(strings.users.userCreated)
      void queryClient.invalidateQueries({ queryKey: queryKeys.users })
    },
    onError: notifyError,
  })
}

export function usePatchUser() {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ userId, input }: { userId: string; input: UpdateUserInput }) =>
      api.patch(`/users/${userId}`, adminUserResponseSchema, { body: input }),
    onSuccess: () => {
      notifySuccess(strings.users.userUpdated)
      void queryClient.invalidateQueries({ queryKey: queryKeys.users })
    },
    onError: notifyError,
  })
}

export function usePatchLane() {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ laneId, input }: { laneId: string; input: UpdateLaneInput; label?: string }) =>
      api.patch(`/lanes/${laneId}`, laneSchema, { body: input }),
    onSuccess: (_lane, { label }) => {
      // Name the column so a table of identical Save buttons confirms clearly.
      notifySuccess(label === undefined ? strings.lanes.saved : strings.lanes.savedNamed(label))
      void queryClient.invalidateQueries({ queryKey: queryKeys.board })
    },
    onError: notifyError,
  })
}

/** `POST /lanes` — adds a column at the end of the board. */
export function useCreateLane() {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateLaneInput) => api.post('/lanes', laneSchema, { body: input }),
    onSuccess: (lane) => {
      notifySuccess(strings.lanes.laneAdded(lane.label))
      void queryClient.invalidateQueries({ queryKey: queryKeys.board })
    },
    onError: notifyError,
  })
}

/** `POST /lanes/reorder` — rewrites column order from the full ordered id list. */
export function useReorderLanes() {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (orderedIds: string[]) =>
      api.post('/lanes/reorder', z.array(laneSchema), { body: { orderedIds } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.board })
    },
    onError: notifyError,
  })
}

/** `DELETE /lanes/:id` — removes an empty, admin-added column. */
export function useDeleteLane() {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (laneId: string) => api.deleteVoid(`/lanes/${laneId}`),
    onSuccess: () => {
      notifySuccess(strings.lanes.laneDeleted)
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
      notifySuccess(strings.policy.saved)
      void queryClient.invalidateQueries({ queryKey: queryKeys.policy })
    },
    // A 409 role-in-use is shown inline in the editor (mirrors the locations
    // pattern); every other error toasts.
    onError: notifyUnlessConflict,
  })
}

// A duplicate sibling name (409) is a friendly, recoverable form error the
// caller shows INLINE beside the name field — a red toast would double up and
// read as a system failure. Every other error still toasts.
function notifyUnlessConflict(error: unknown): void {
  if (isConflictError(error)) return
  notifyError(error)
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
    onError: notifyUnlessConflict,
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
    onError: notifyUnlessConflict,
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

/** Mints a fresh secret in place (same reveal-once response as create). */
export function useRotateServiceToken() {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (tokenId: string) =>
      api.post(`/service-tokens/${tokenId}/rotate`, createdServiceTokenSchema),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.serviceTokens })
    },
    onError: notifyError,
  })
}
