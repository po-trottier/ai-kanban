import { PASSWORD_MIN_LENGTH } from '@rivian-kanban/core'
import { Center, Paper, PasswordInput, Stack, Text, Title } from '@mantine/core'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { KeyRound } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { useChangePassword } from '../api/auth.ts'
import { notifySuccess } from '../api/notify.ts'
import { ErrorAlert } from '../shell/ErrorAlert.tsx'
import { HintButton } from '../shell/HintButton.tsx'
import { strings } from '../strings.ts'
import { SIZES } from '../theme.ts'

const changePasswordFormSchema = z
  .object({
    currentPassword: z.string().min(1, strings.auth.passwordRequired),
    // The shared policy constant — the server's password-policy module
    // enforces the same number (plus the max/common-password checks).
    newPassword: z.string().min(PASSWORD_MIN_LENGTH, strings.auth.passwordMinLength),
    confirmPassword: z.string(),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    path: ['confirmPassword'],
    message: strings.auth.passwordMismatch,
  })
type ChangePasswordFormValues = z.infer<typeof changePasswordFormSchema>

/**
 * The must-change-password interstitial: while the flag is set every other
 * route returns 403, so `RequireAuth` renders this instead of the app.
 */
export function ChangePasswordPage() {
  const changePassword = useChangePassword()
  const form = useForm<ChangePasswordFormValues>({
    resolver: standardSchemaResolver(changePasswordFormSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  })

  return (
    <Center h="100vh">
      <Paper withBorder shadow="sm" p="xl" radius="md" w={SIZES.authCardWidth}>
        <form
          noValidate
          onSubmit={(event) => {
            void form.handleSubmit((values) => {
              changePassword.mutate(
                { currentPassword: values.currentPassword, newPassword: values.newPassword },
                {
                  onSuccess: () => {
                    notifySuccess(strings.auth.passwordChanged)
                  },
                },
              )
            })(event)
          }}
        >
          <Stack gap="md">
            <Title order={1} size="h3">
              {strings.auth.changePasswordTitle}
            </Title>
            <Text size="sm" c="dimmed">
              {strings.auth.changePasswordIntro}
            </Text>
            {changePassword.error !== null ? <ErrorAlert error={changePassword.error} /> : null}
            <PasswordInput
              label={strings.auth.currentPassword}
              autoComplete="current-password"
              error={form.formState.errors.currentPassword?.message}
              {...form.register('currentPassword')}
            />
            <PasswordInput
              label={strings.auth.newPassword}
              autoComplete="new-password"
              error={form.formState.errors.newPassword?.message}
              {...form.register('newPassword')}
            />
            <PasswordInput
              label={strings.auth.confirmPassword}
              autoComplete="new-password"
              error={form.formState.errors.confirmPassword?.message}
              {...form.register('confirmPassword')}
            />
            <HintButton
              type="submit"
              tooltip={strings.tooltips.changePassword}
              loading={changePassword.isPending}
              leftSection={<KeyRound size={16} aria-hidden />}
            >
              {strings.auth.changePasswordButton}
            </HintButton>
          </Stack>
        </form>
      </Paper>
    </Center>
  )
}
