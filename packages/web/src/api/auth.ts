import { type SetupAdminInput, type UpdateProfileInput, type User } from '@rivian-kanban/core'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useGlobalApi, useGlobalQueryClient } from './global-api-context.ts'
import { queryKeys } from './keys.ts'
import { loginResponseSchema, meResponseSchema, setupStatusResponseSchema } from './schemas.ts'
import { clearSessionData } from './query-client.ts'

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
  const api = useGlobalApi()
  const queryClient = useGlobalQueryClient()
  return useQuery<User | null>({
    queryKey: queryKeys.me,
    queryFn: async () => {
      const user = await api.get('/auth/me', meResponseSchema)
      const previous = queryClient.getQueryData<User | null>(queryKeys.me)
      if (previous != null && previous.id !== user.id) {
        clearSessionData(queryClient)
      }
      return user
    },
  })
}

/**
 * First-boot probe (unauthenticated, like login): while true, every page —
 * including /login — redirects to /setup; once false it never flips back.
 */
export function useSetupRequired() {
  const api = useGlobalApi()
  return useQuery({
    queryKey: queryKeys.setup,
    queryFn: () => api.get('/setup', setupStatusResponseSchema),
  })
}

/** `POST /setup` — creates the first admin; the response mirrors login. */
export function useSetupAdmin() {
  const api = useGlobalApi()
  const queryClient = useGlobalQueryClient()
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
  const api = useGlobalApi()
  const queryClient = useGlobalQueryClient()
  return useMutation({
    mutationFn: (input: LoginInput) =>
      api.post('/auth/login', loginResponseSchema, { body: input }),
    onSuccess: (user) => {
      clearSessionData(queryClient)
      queryClient.setQueryData(queryKeys.me, user)
    },
  })
}

export function useLogout() {
  const api = useGlobalApi()
  const queryClient = useGlobalQueryClient()
  return useMutation({
    mutationFn: () => api.postVoid('/auth/logout'),
    onSuccess: () => {
      clearSessionData(queryClient)
      queryClient.setQueryData(queryKeys.me, null)
    },
  })
}

export function useChangePassword() {
  const api = useGlobalApi()
  const queryClient = useGlobalQueryClient()
  return useMutation({
    mutationFn: (input: ChangePasswordInput) =>
      api.postVoid('/auth/change-password', { body: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.me })
    },
  })
}

/** `PATCH /auth/me` — the signed-in user updates their own profile (time zone). */
export function useUpdateProfile() {
  const api = useGlobalApi()
  const queryClient = useGlobalQueryClient()
  return useMutation({
    mutationFn: (input: UpdateProfileInput) =>
      api.patch('/auth/me', meResponseSchema, { body: input }),
    onSuccess: (user) => {
      // The server returns the updated User; write it straight into the cache
      // so every date render re-flows into the new zone immediately.
      queryClient.setQueryData(queryKeys.me, user)
    },
  })
}
