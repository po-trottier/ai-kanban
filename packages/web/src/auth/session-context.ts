import { type User } from '@rivian-kanban/core'
import { createContext, useContext } from 'react'

/** The signed-in user, provided by `RequireAuth` once `/auth/me` resolves. */
export const SessionContext = createContext<User | null>(null)

export function useCurrentUser(): User {
  const user = useContext(SessionContext)
  if (user === null) throw new Error('useCurrentUser called outside an authenticated session')
  return user
}

/** The signed-in user's IANA display time zone — the single source every date render reads. */
export function useUserTimezone(): string {
  return useCurrentUser().timezone
}
