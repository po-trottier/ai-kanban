import { WAITING_REASONS, type WaitingReason } from '@rivian-kanban/core'
import { Button, Group, Modal, Select, Stack, Text } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { useState } from 'react'
import { strings } from '../strings.ts'

export interface WaitingLaneModalProps {
  onSubmit: (values: { waitingReason: WaitingReason; expectedResumeAt: string }) => void
  onClose: () => void
}

/**
 * Always-on data rule (never policy): entering Waiting on Parts / Vendor
 * requires a reason and an expected resume date.
 */
export function WaitingLaneModal({ onSubmit, onClose }: WaitingLaneModalProps) {
  const [reason, setReason] = useState<WaitingReason | null>(null)
  const [resumeAt, setResumeAt] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)

  const reasonError = touched && reason === null ? strings.waiting.reasonRequired : null
  const resumeError = touched && resumeAt === null ? strings.waiting.resumeRequired : null

  return (
    <Modal opened onClose={onClose} title={strings.waiting.modalTitle}>
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          {strings.waiting.intro}
        </Text>
        <Select
          label={strings.waiting.reasonLabel}
          data={WAITING_REASONS.map((value) => ({
            value,
            label: strings.waiting.reasons[value],
          }))}
          value={reason}
          error={reasonError}
          onChange={(value) => {
            setReason(value)
          }}
        />
        <DatePickerInput
          label={strings.waiting.resumeLabel}
          value={resumeAt}
          error={resumeError}
          onChange={setResumeAt}
        />
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onClose}>
            {strings.common.cancel}
          </Button>
          <Button
            onClick={() => {
              setTouched(true)
              if (reason === null || resumeAt === null) return
              onSubmit({ waitingReason: reason, expectedResumeAt: resumeAt })
            }}
          >
            {strings.waiting.confirm}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
