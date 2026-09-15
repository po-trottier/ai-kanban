import {
  Alert,
  Button,
  Center,
  Divider,
  Group,
  Input,
  SegmentedControl,
  Select,
  Stack,
  Text,
  Title,
} from '@mantine/core'
import { Monitor, Moon, RefreshCw, Save, Sun } from 'lucide-react'
import { THEMES, type Theme } from '@rivian-kanban/core'
import { useState } from 'react'
import { useUpdateProfile } from '../api/auth.ts'
import { useAppVersion } from '../api/meta.ts'
import { formatDateTime } from '../lib/format.ts'
import { notifyError, notifySuccess } from '../api/notify.ts'
import { useCurrentUser } from '../auth/session-context.ts'
import { HintButton } from '../shell/HintButton.tsx'
import { strings } from '../strings.ts'
import { TIMEZONE_SELECT_DATA } from './timezone-select-data.ts'

/** One lucide glyph per theme mode, rendered beside its text in the control. */
const THEME_ICONS: Record<Theme, typeof Sun> = { light: Sun, dark: Moon, system: Monitor }

/** Light/Dark/System options with an icon + text label (accessible name stays
 *  the text, so tests still target `radio` by 'Light' / 'Dark' / 'System'). */
const THEME_SELECT_DATA = THEMES.map((value) => {
  const Icon = THEME_ICONS[value]
  return {
    value,
    label: (
      <Center style={{ gap: 6 }} component="span">
        <Icon size={14} aria-hidden />
        <span>{strings.profile.themes[value]}</span>
      </Center>
    ),
  }
})

/**
 * The per-user preferences (display time zone + theme) — the first Settings
 * tab, reachable by every role. PATCHes /auth/me with the picked prefs. The
 * draft seeds from the live user; the tab remounts on tab switch (keepMounted
 * off) so it always reflects the current values.
 */
export function PreferencesTab() {
  const me = useCurrentUser()
  const update = useUpdateProfile()
  const build = useAppVersion()
  const [timezone, setTimezone] = useState(me.timezone)
  const [theme, setTheme] = useState<Theme>(me.theme)

  const save = () => {
    update.mutate(
      { timezone, theme },
      {
        onSuccess: () => {
          notifySuccess(strings.profile.saved)
        },
        onError: notifyError,
      },
    )
  }

  return (
    <Stack gap="md">
      <Input.Wrapper label={strings.profile.themeLabel} description={strings.profile.themeHelp}>
        <div>
          <SegmentedControl
            fullWidth
            data={THEME_SELECT_DATA}
            value={theme}
            onChange={(value) => {
              setTheme(value)
            }}
          />
        </div>
      </Input.Wrapper>
      <Select
        label={strings.profile.timezoneLabel}
        description={strings.profile.timezoneHelp}
        data={TIMEZONE_SELECT_DATA}
        value={timezone}
        onChange={(value) => {
          if (value !== null) setTimezone(value)
        }}
        searchable
        allowDeselect={false}
        nothingFoundMessage={strings.profile.timezoneNothingFound}
      />
      <HintButton
        tooltip={strings.tooltips.savePreferences}
        onClick={save}
        loading={update.isPending}
        leftSection={<Save size={16} aria-hidden />}
        w="fit-content"
      >
        {strings.common.save}
      </HintButton>
      <Divider />
      <Stack gap="xs" component="section" aria-label={strings.about.title}>
        <Group justify="space-between">
          <Title order={3}>{strings.about.title}</Title>
          <Button
            variant="subtle"
            size="xs"
            loading={build.isFetching}
            leftSection={<RefreshCw size={16} aria-hidden />}
            onClick={() => {
              void build.refetch()
            }}
          >
            {strings.about.refresh}
          </Button>
        </Group>
        <Text size="sm" c="dimmed">
          {strings.about.description}
        </Text>
        <div aria-live="polite">
          {build.isError ? (
            <Alert color="red">{strings.about.failed}</Alert>
          ) : build.isFetching ? (
            <Text size="sm">{strings.about.loading}</Text>
          ) : build.data ? (
            <Stack gap="xs">
              <Text size="sm">
                {strings.about.version}:{' '}
                <Text component="span" fw={600}>
                  {build.data.version === 'dev' ? strings.about.development : build.data.version}
                </Text>
              </Text>
              <Text size="sm">
                {strings.about.revision}:{' '}
                <Text component="span" title={build.data.gitSha}>
                  {build.data.gitSha.slice(0, 12)}
                </Text>
              </Text>
              {Number.isFinite(Date.parse(build.data.builtAt)) ? (
                <Text size="sm">
                  {strings.about.builtAt}: {formatDateTime(build.data.builtAt, me.timezone)}
                </Text>
              ) : null}
            </Stack>
          ) : null}
        </div>
      </Stack>
    </Stack>
  )
}
