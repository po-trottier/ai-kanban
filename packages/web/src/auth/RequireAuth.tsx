import { Center, Loader, useMantineColorScheme } from '@mantine/core'
import { type Theme } from '@rivian-kanban/core'
import { useEffect } from 'react'
import { Navigate, Outlet } from 'react-router'
import { useMe } from '../api/auth.ts'
import { isUnauthorizedError } from '../api/problem.ts'
import { ErrorAlert } from '../shell/ErrorAlert.tsx'
import { strings } from '../strings.ts'
import { ChangePasswordPage } from './ChangePasswordPage.tsx'
import { SessionContext } from './session-context.ts'

/**
 * Applies the signed-in user's theme to Mantine's color scheme whenever it
 * changes. `system` maps to Mantine's `auto` (follows prefers-color-scheme);
 * an explicit light/dark pins the scheme. Renders nothing — it is only the
 * effect, mounted inside the authed session so `me.theme` is always defined.
 */
function ThemeSync({ theme }: { theme: Theme }) {
  const { setColorScheme } = useMantineColorScheme()
  useEffect(() => {
    setColorScheme(theme === 'system' ? 'auto' : theme)
  }, [theme, setColorScheme])
  return null
}

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
      <ThemeSync theme={me.data.theme} />
      <Outlet />
    </SessionContext.Provider>
  )
}
