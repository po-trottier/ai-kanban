import { type User } from '@rivian-kanban/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useApi } from './api-context.ts'
import { queryKeys } from './keys.ts'
import { loginResponseSchema, meResponseSchema } from './schemas.ts'

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
