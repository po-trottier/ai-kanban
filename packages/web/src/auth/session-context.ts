import { type User } from '@rivian-kanban/core'
import { createContext, useContext } from 'react'

/** The signed-in user, provided by `RequireAuth` once `/auth/me` resolves. */
export const SessionContext = createContext<User | null>(null)

export function useCurrentUser(): User {
  const user = useContext(SessionContext)
  if (user === null) throw new Error('useCurrentUser called outside an authenticated session')
  return user
}
