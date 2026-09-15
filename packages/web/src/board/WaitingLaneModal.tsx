import { type WaitingReason } from '@rivian-kanban/core'
import { Group, Modal, Select, Stack, Text, Textarea } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { useState } from 'react'
import { useUserTimezone } from '../auth/session-context.ts'
import { todayInTimezone } from '../lib/format.ts'
import { HintButton } from '../shell/HintButton.tsx'
import { strings } from '../strings.ts'
import { useWaitingReasons } from '../api/meta.ts'
import { waitingReasonOptions } from '../lib/waiting-reasons.ts'

export interface WaitingLaneModalProps {
  onSubmit: (values: {
    waitingReason: WaitingReason
    expectedResumeAt: string
    /** Optional note, posted as a card comment after the move. */
    comment?: string
  }) => void
  onClose: () => void
}

/**
 * Always-on data rule (never policy): entering Waiting on Parts / Vendor
 * requires a reason and an expected resume date; a free-text note is optional.
 */
export function WaitingLaneModal({ onSubmit, onClose }: WaitingLaneModalProps) {
  const options = waitingReasonOptions(useWaitingReasons())
  const timezone = useUserTimezone()
  const [reason, setReason] = useState<WaitingReason | null>(null)
  const [resumeAt, setResumeAt] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [touched, setTouched] = useState(false)

  const reasonError =
    touched && !options.some((option) => option.value === reason)
      ? strings.waiting.reasonRequired
      : null
  const resumeError = touched && resumeAt === null ? strings.waiting.resumeRequired : null

  return (
    <Modal opened onClose={onClose} title={strings.waiting.modalTitle} centered>
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          {strings.waiting.intro}
        </Text>
        <Select
          label={strings.waiting.reasonLabel}
          data={options}
          description={options.length === 0 ? strings.waiting.noReasons : undefined}
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
          minDate={todayInTimezone(timezone)}
          highlightToday
        />
        <Textarea
          label={strings.waiting.commentLabel}
          placeholder={strings.waiting.commentPlaceholder}
          value={comment}
          onChange={(event) => {
            setComment(event.currentTarget.value)
          }}
          autosize
          minRows={2}
          maxRows={5}
        />
        <Group justify="flex-end" gap="sm">
          <HintButton tooltip={strings.tooltips.cancelDialog} variant="default" onClick={onClose}>
            {strings.common.cancel}
          </HintButton>
          <HintButton
            tooltip={strings.tooltips.move}
            onClick={() => {
              setTouched(true)
              if (
                reason === null ||
                resumeAt === null ||
                !options.some((option) => option.value === reason)
              )
                return
              const note = comment.trim()
              onSubmit({
                waitingReason: reason,
                expectedResumeAt: resumeAt,
                ...(note === '' ? {} : { comment: note }),
              })
            }}
          >
            {strings.waiting.confirm}
          </HintButton>
        </Group>
      </Stack>
    </Modal>
  )
}
