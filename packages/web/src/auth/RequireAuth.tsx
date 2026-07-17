import { Center, Loader } from '@mantine/core'
import { Navigate, Outlet } from 'react-router'
import { useMe } from '../api/auth.ts'
import { isUnauthorizedError } from '../api/problem.ts'
import { ErrorAlert } from '../shell/ErrorAlert.tsx'
import { strings } from '../strings.ts'
import { ChangePasswordPage } from './ChangePasswordPage.tsx'
import { SessionContext } from './session-context.ts'

/**
 * Session gate: 401 → login, `mustChangePassword` → interstitial, otherwise
 * provides the current user to the routed app.
 */
export function RequireAuth() {
  const me = useMe()

  if (me.isPending) {
    return (
      <Center h="100vh" aria-label={strings.common.loading} aria-busy>
        <Loader />
      </Center>
    )
  }
  if (me.data === null || isUnauthorizedError(me.error)) {
    return <Navigate to="/login" replace />
  }
  if (me.error !== null) {
    return (
      <Center h="100vh">
        <ErrorAlert error={me.error} />
      </Center>
    )
  }
  if (me.data.mustChangePassword) {
    return <ChangePasswordPage />
  }
  return (
    <SessionContext.Provider value={me.data}>
      <Outlet />
    </SessionContext.Provider>
  )
}
