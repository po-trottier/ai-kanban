import { Button, Input, Modal, SegmentedControl, Select, Stack } from '@mantine/core'
import { THEMES, type Theme } from '@rivian-kanban/core'
import { useState } from 'react'
import { useUpdateProfile } from '../api/auth.ts'
import { notifyError, notifySuccess } from '../api/notify.ts'
import { useCurrentUser } from '../auth/session-context.ts'
import { strings } from '../strings.ts'
import { TIMEZONE_SELECT_DATA } from './timezone-select-data.ts'

/** Light/Dark/System options for the theme control (label per strings). */
const THEME_SELECT_DATA = THEMES.map((value) => ({
  value,
  label: strings.profile.themes[value],
}))

/**
 * Per-user preferences (the avatar-menu "Preferences" item, reachable by every
 * role — unlike the admin-only Settings page): the display time zone and theme.
 * Mounted only while open, so its draft always seeds from the live user.
 */
export function ProfileSettingsModal({ onClose }: { onClose: () => void }) {
  const me = useCurrentUser()
  const update = useUpdateProfile()
  const [timezone, setTimezone] = useState(me.timezone)
  const [theme, setTheme] = useState<Theme>(me.theme)

  const save = () => {
    update.mutate(
      { timezone, theme },
      {
        onSuccess: () => {
          notifySuccess(strings.profile.saved)
          onClose()
        },
        onError: notifyError,
      },
    )
  }

  return (
    <Modal opened onClose={onClose} title={strings.profile.title} centered>
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
        <Button onClick={save} loading={update.isPending}>
          {strings.common.save}
        </Button>
      </Stack>
    </Modal>
  )
}
