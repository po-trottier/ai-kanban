import {
  Alert,
  Center,
  Image,
  Loader,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { LogIn } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { Navigate, useNavigate } from 'react-router'
import { z } from 'zod'
import { useLogin, useSetupRequired } from '../api/auth.ts'
import { isUnauthorizedError } from '../api/problem.ts'
import { ErrorAlert } from '../shell/ErrorAlert.tsx'
import { HintButton } from '../shell/HintButton.tsx'
import { strings } from '../strings.ts'
import { SIZES } from '../theme.ts'
import { AuthShell } from './AuthShell.tsx'
import classes from './auth.module.css'

/** Login credentials are an auth concern, not a core domain shape. */
const loginFormSchema = z.object({
  email: z.email(strings.auth.emailInvalid),
  password: z.string().min(1, strings.auth.passwordRequired),
})
type LoginFormValues = z.infer<typeof loginFormSchema>

/**
 * Ask the browser to save the just-used credentials. A fetch-based SPA login
 * followed by client-side navigation does NOT reliably trigger the "save
 * password?" prompt a native form POST would, so the password manager never
 * offers to store them. The Credential Management API requests it explicitly.
 * Chromium-only (a no-op where `PasswordCredential` is absent, e.g. Firefox/
 * Safari/tests, which fall back to their own form heuristics); best-effort, so
 * a refusal is swallowed.
 */
function offerToSaveCredential(email: string, password: string): void {
  const Ctor = (
    window as typeof window & {
      PasswordCredential?: new (data: { id: string; password: string }) => Credential
    }
  ).PasswordCredential
  if (Ctor === undefined) return
  try {
    void navigator.credentials.store(new Ctor({ id: email, password }))
  } catch {
    // Progressive enhancement — ignore if the browser declines to store.
  }
}

/**
 * The OAuth login hop (ADR-021): `GET /oauth/authorize` bounces an
 * unauthenticated agent here with `?returnTo=<absolute /oauth/authorize URL>`.
 * After login we send the BROWSER back to that server route (not react-router).
 *
 * Open-redirect guard: accept ONLY a SAME-ORIGIN URL whose path is exactly
 * `/oauth/authorize`. Anything else (another origin, another path, a
 * `javascript:`/`//evil.com` payload) is rejected — resolving against our own
 * origin and re-checking the origin defeats protocol- and host-relative tricks.
 * Returns the safe absolute URL to assign, or null.
 */
function safeOAuthReturnTo(rawReturnTo: string | null): string | null {
  if (rawReturnTo === null || rawReturnTo === '') return null
  let url: URL
  try {
    url = new URL(rawReturnTo, window.location.origin)
  } catch {
    return null
  }
  if (url.origin !== window.location.origin) return null
  if (url.pathname !== '/oauth/authorize') return null
  return url.toString()
}

export function LoginPage() {
  const navigate = useNavigate()
  const setupRequired = useSetupRequired()
  const login = useLogin()
  const form = useForm<LoginFormValues>({
    resolver: standardSchemaResolver(loginFormSchema),
    defaultValues: { email: '', password: '' },
  })

  // First boot: until the initial admin exists, nobody can sign in — every
  // page (this one included) lands on /setup. Errors fall through to the
  // form: login must stay reachable even if the probe misbehaves.
  if (setupRequired.isPending) {
    return (
      <Center h="100vh" aria-label={strings.common.loading} aria-busy>
        <Loader />
      </Center>
    )
  }
  if (setupRequired.data?.required === true) {
    return <Navigate to="/setup" replace />
  }

  return (
    <AuthShell>
      <Paper withBorder shadow="sm" p="xl" radius="md" w={SIZES.authCardWidth}>
        <form
          noValidate
          onSubmit={(event) => {
            void form.handleSubmit((values) => {
              login.mutate(values, {
                onSuccess: () => {
                  // Prompt the browser's password manager to save (fetch logins
                  // don't trigger it automatically), then continue.
                  offerToSaveCredential(values.email, values.password)
                  const returnTo = safeOAuthReturnTo(
                    new URLSearchParams(window.location.search).get('returnTo'),
                  )
                  if (returnTo !== null) {
                    // A server route, not a react-router path — hard navigate.
                    window.location.assign(returnTo)
                    return
                  }
                  void navigate('/')
                },
              })
            })(event)
          }}
        >
          <Stack gap="md">
            {/* Brand header centered over the (left-aligned) form fields. */}
            <Stack gap="xs" align="center">
              <Image
                src="/logo.png"
                alt=""
                h={SIZES.authLogoHeight}
                w="auto"
                fit="contain"
                className={classes.logo}
              />
              <Title order={2} size="h4" c="dimmed">
                {strings.appTitle}
              </Title>
              <Title order={1} size="h3">
                {strings.auth.loginTitle}
              </Title>
            </Stack>
            {login.error !== null ? (
              // A bad login is an expected, specific case: show friendly copy
              // rather than echoing the raw problem+json title ("Unauthorized").
              isUnauthorizedError(login.error) ? (
                <Alert color="red">{strings.auth.loginFailed}</Alert>
              ) : (
                <ErrorAlert error={login.error} />
              )
            ) : null}
            <TextInput
              label={strings.auth.email}
              type="email"
              autoComplete="username"
              error={form.formState.errors.email?.message}
              {...form.register('email')}
            />
            <PasswordInput
              label={strings.auth.password}
              autoComplete="current-password"
              error={form.formState.errors.password?.message}
              {...form.register('password')}
            />
            <HintButton
              type="submit"
              tooltip={strings.tooltips.signIn}
              loading={login.isPending}
              leftSection={<LogIn size={16} aria-hidden />}
            >
              {strings.auth.loginButton}
            </HintButton>
            <Text size="sm" c="dimmed">
              {strings.auth.forgotHelp}
            </Text>
          </Stack>
        </form>
      </Paper>
    </AuthShell>
  )
}
