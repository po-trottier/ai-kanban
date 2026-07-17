import {
  Alert,
  Button,
  Center,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router'
import { z } from 'zod'
import { useLogin } from '../api/auth.ts'
import { isUnauthorizedError } from '../api/problem.ts'
import { ErrorAlert } from '../shell/ErrorAlert.tsx'
import { strings } from '../strings.ts'
import { SIZES } from '../theme.ts'

/** Login credentials are an auth concern, not a core domain shape. */
const loginFormSchema = z.object({
  email: z.email(strings.auth.emailInvalid),
  password: z.string().min(1, strings.auth.passwordRequired),
})
type LoginFormValues = z.infer<typeof loginFormSchema>

export function LoginPage() {
  const navigate = useNavigate()
  const login = useLogin()
  const form = useForm<LoginFormValues>({
    resolver: standardSchemaResolver(loginFormSchema),
    defaultValues: { email: '', password: '' },
  })

  return (
    <Center h="100vh">
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
            <Stack gap="xs">
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
    </Center>
  )
}
