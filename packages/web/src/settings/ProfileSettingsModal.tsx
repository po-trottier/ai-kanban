import { Button, Modal, Select, Stack } from '@mantine/core'
import { useState } from 'react'
import { useUpdateProfile } from '../api/auth.ts'
import { notifyError, notifySuccess } from '../api/notify.ts'
import { useCurrentUser } from '../auth/session-context.ts'
import { strings } from '../strings.ts'
import { TIMEZONE_SELECT_DATA } from './timezone-select-data.ts'

/**
 * Per-user preferences (the avatar-menu "Preferences" item, reachable by every
 * role — unlike the admin-only Settings page). Currently just the display time
 * zone. Mounted only while open, so its draft always seeds from the live user.
 */
export function ProfileSettingsModal({ onClose }: { onClose: () => void }) {
  const me = useCurrentUser()
  const update = useUpdateProfile()
  const [timezone, setTimezone] = useState(me.timezone)

  const save = () => {
    update.mutate(
      { timezone },
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
