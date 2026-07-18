import {
  Alert,
  Button,
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
import { useForm } from 'react-hook-form'
import { Navigate, useNavigate } from 'react-router'
import { z } from 'zod'
import { useLogin, useSetupRequired } from '../api/auth.ts'
import { isUnauthorizedError } from '../api/problem.ts'
import { ErrorAlert } from '../shell/ErrorAlert.tsx'
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
            <Button type="submit" loading={login.isPending}>
              {strings.auth.loginButton}
            </Button>
            <Text size="sm" c="dimmed">
              {strings.auth.forgotHelp}
            </Text>
          </Stack>
        </form>
      </Paper>
    </AuthShell>
  )
}
