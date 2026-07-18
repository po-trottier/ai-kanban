import { PASSWORD_MIN_LENGTH, timezoneSchema, type SetupAdminInput } from '@rivian-kanban/core'
import {
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
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Navigate, useNavigate } from 'react-router'
import { z } from 'zod'
import { useSetupAdmin, useSetupRequired } from '../api/auth.ts'
import { detectBrowserTimezone } from '../settings/timezone-select-data.ts'
import { ErrorAlert } from '../shell/ErrorAlert.tsx'
import { strings } from '../strings.ts'
import { SIZES } from '../theme.ts'
import { AuthShell } from './AuthShell.tsx'
import classes from './auth.module.css'
import { SetupLocations } from './SetupLocations.tsx'

/**
 * Form-side messages over core's `setupAdminInputSchema` shape (the values
 * type IS the shared input type). The password minimum is the shared policy
 * constant — the server enforces the full policy (max + common-password).
 */
const setupFormSchema = z.object({
  email: z.email(strings.auth.emailInvalid),
  displayName: z.string().trim().min(1, strings.setup.displayNameRequired).max(100),
  password: z.string().min(PASSWORD_MIN_LENGTH, strings.auth.passwordMinLength),
  // Auto-detected from the browser (no visible field); the server defaults it
  // to PST if ever absent. Carried so the first admin's zone matches their machine.
  timezone: timezoneSchema,
})

/**
 * First-boot setup page: while the database has no users, every route lands
 * here. It runs a two-step wizard entirely on /setup (no new routes, internal
 * state only): Step 1 creates the first admin account — on success the session
 * is already established — then Step 2 offers an OPTIONAL locations editor
 * before both "Skip for now" and "Continue to board" land on the board. Once
 * any user exists the page permanently redirects to /login (the endpoint
 * hard-disables itself — docs/architecture/security.md#authentication).
 */
export function SetupPage() {
  const navigate = useNavigate()
  const setupRequired = useSetupRequired()
  const [step, setStep] = useState<'account' | 'locations'>('account')

  if (setupRequired.isPending) {
    return (
      <Center h="100vh" aria-label={strings.common.loading} aria-busy>
        <Loader />
      </Center>
    )
  }
  // Only redirect while still on Step 1. Creating the admin flips the probe to
  // `required: false` (and `useSetupAdmin` invalidates it), so once we've
  // advanced to the OPTIONAL locations step we must ignore that — the session
  // is already live and the wizard finishes on its own terms. A returning
  // already-set-up admin never reaches Step 2, so it still bounces to /login.
  if (step === 'account' && setupRequired.data?.required !== true) {
    return <Navigate to="/login" replace />
  }

  return (
    <AuthShell>
      <Paper withBorder shadow="sm" p="xl" radius="md" w={SIZES.authCardWidth}>
        {step === 'account' ? (
          <SetupAccountForm
            onCreated={() => {
              setStep('locations')
            }}
          />
        ) : (
          <SetupLocations
            onDone={() => {
              void navigate('/')
            }}
          />
        )}
      </Paper>
    </AuthShell>
  )
}

/** Step 1: create the first admin. On success the session is live. */
function SetupAccountForm({ onCreated }: { onCreated: () => void }) {
  const setup = useSetupAdmin()
  const form = useForm<SetupAdminInput>({
    resolver: standardSchemaResolver(setupFormSchema),
    defaultValues: { email: '', displayName: '', password: '', timezone: detectBrowserTimezone() },
  })

  return (
    <form
      noValidate
      onSubmit={(event) => {
        void form.handleSubmit((values) => {
          setup.mutate(values, { onSuccess: onCreated })
        })(event)
      }}
    >
      <Stack gap="md">
        <Stack gap="xs">
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
            {strings.setup.title}
          </Title>
        </Stack>
        <Text size="sm" c="dimmed">
          {strings.setup.intro}
        </Text>
        {setup.error !== null ? <ErrorAlert error={setup.error} /> : null}
        {/* Name before email — consistent with the settings add-user form and
            the users table (Name, Email, Role). */}
        <TextInput
          label={strings.setup.displayName}
          autoComplete="name"
          error={form.formState.errors.displayName?.message}
          {...form.register('displayName')}
        />
        <TextInput
          label={strings.auth.email}
          type="email"
          autoComplete="email"
          error={form.formState.errors.email?.message}
          {...form.register('email')}
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
  )
}
