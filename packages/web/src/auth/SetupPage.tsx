import { PASSWORD_MIN_LENGTH, type SetupAdminInput } from '@rivian-kanban/core'
import {
  Button,
  Center,
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
import { useSetupAdmin, useSetupRequired } from '../api/auth.ts'
import { ErrorAlert } from '../shell/ErrorAlert.tsx'
import { strings } from '../strings.ts'
import { SIZES } from '../theme.ts'

/**
 * Form-side messages over core's `setupAdminInputSchema` shape (the values
 * type IS the shared input type). The password minimum is the shared policy
 * constant — the server enforces the full policy (max + common-password).
 */
const setupFormSchema = z.object({
  email: z.email(strings.auth.emailInvalid),
  displayName: z.string().trim().min(1, strings.setup.displayNameRequired).max(100),
  password: z.string().min(PASSWORD_MIN_LENGTH, strings.auth.passwordMinLength),
})

/**
 * First-boot setup page: while the database has no users, every route lands
 * here to create the first admin account; on success the session is already
 * established, so the board loads directly. Once any user exists the page
 * permanently redirects to /login (the endpoint hard-disables itself —
 * docs/architecture/security.md#authentication).
 */
export function SetupPage() {
  const navigate = useNavigate()
  const setupRequired = useSetupRequired()
  const setup = useSetupAdmin()
  const form = useForm<SetupAdminInput>({
    resolver: standardSchemaResolver(setupFormSchema),
    defaultValues: { email: '', displayName: '', password: '' },
  })

  if (setupRequired.isPending) {
    return (
      <Center h="100vh" aria-label={strings.common.loading} aria-busy>
        <Loader />
      </Center>
    )
  }
  if (setupRequired.data?.required !== true) {
    return <Navigate to="/login" replace />
  }

  return (
    <Center h="100vh">
      <Paper withBorder shadow="sm" p="xl" radius="md" w={SIZES.authCardWidth}>
        <form
          noValidate
          onSubmit={(event) => {
            void form.handleSubmit((values) => {
              setup.mutate(values, {
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
                {strings.setup.title}
              </Title>
            </Stack>
            <Text size="sm" c="dimmed">
              {strings.setup.intro}
            </Text>
            {setup.error !== null ? <ErrorAlert error={setup.error} /> : null}
            <TextInput
              label={strings.auth.email}
              type="email"
              autoComplete="email"
              error={form.formState.errors.email?.message}
              {...form.register('email')}
            />
            <TextInput
              label={strings.setup.displayName}
              autoComplete="name"
              error={form.formState.errors.displayName?.message}
              {...form.register('displayName')}
            />
            <PasswordInput
              label={strings.auth.password}
              autoComplete="new-password"
              error={form.formState.errors.password?.message}
              {...form.register('password')}
            />
            <Button type="submit" loading={setup.isPending}>
              {strings.setup.submitButton}
            </Button>
          </Stack>
        </form>
      </Paper>
    </Center>
  )
}
