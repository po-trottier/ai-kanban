import { type SetupAdminInput, type User } from '@rivian-kanban/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useApi } from './api-context.ts'
import { queryKeys } from './keys.ts'
import { loginResponseSchema, meResponseSchema, setupStatusResponseSchema } from './schemas.ts'

export interface LoginInput {
  email: string
  password: string
}

export interface ChangePasswordInput {
  currentPassword: string
  newPassword: string
}

/** The session query. `null` means "definitely signed out" (set on 401). */
export function useMe() {
  const api = useApi()
  return useQuery<User | null>({
    queryKey: queryKeys.me,
    queryFn: () => api.get('/auth/me', meResponseSchema),
  })
}

/**
 * First-boot probe (unauthenticated, like login): while true, every page —
 * including /login — redirects to /setup; once false it never flips back.
 */
export function useSetupRequired() {
  const api = useApi()
  return useQuery({
    queryKey: queryKeys.setup,
    queryFn: () => api.get('/setup', setupStatusResponseSchema),
  })
}

/** `POST /setup` — creates the first admin; the response mirrors login. */
export function useSetupAdmin() {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: SetupAdminInput) =>
      api.post('/setup', loginResponseSchema, { body: input }),
    onSuccess: (user) => {
      // The server already issued the session cookie — transition the cache
      // like a login and drop the stale "setup required" answer.
      queryClient.setQueryData(queryKeys.me, user)
      void queryClient.invalidateQueries({ queryKey: queryKeys.setup })
    },
  })
}

export function useLogin() {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: LoginInput) =>
      api.post('/auth/login', loginResponseSchema, { body: input }),
    onSuccess: (user) => {
      queryClient.setQueryData(queryKeys.me, user)
    },
  })
}

export function useLogout() {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.postVoid('/auth/logout'),
    onSuccess: () => {
      queryClient.clear()
      queryClient.setQueryData(queryKeys.me, null)
    },
  })
}

export function useChangePassword() {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: ChangePasswordInput) =>
      api.postVoid('/auth/change-password', { body: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.me })
    },
  })
}
