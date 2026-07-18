import { Group, Modal, Stack, Textarea } from '@mantine/core'
import { Ban } from 'lucide-react'
import { useState } from 'react'
import { HintButton } from '../shell/HintButton.tsx'
import { strings } from '../strings.ts'

export interface BlockCardModalProps {
  onSubmit: (reason: string) => void
  onClose: () => void
}

/** Blocking flags a card in place with a required reason (docs/product/workflow.md). */
export function BlockCardModal({ onSubmit, onClose }: BlockCardModalProps) {
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const error = touched && reason.trim() === '' ? strings.blockAction.reasonRequired : null

  return (
    <Modal opened onClose={onClose} title={strings.blockAction.modalTitle} centered>
      <Stack gap="md">
        <Textarea
          label={strings.blockAction.reasonLabel}
          placeholder={strings.blockAction.reasonPlaceholder}
          value={reason}
          error={error}
          autosize
          minRows={2}
          onChange={(event) => {
            setReason(event.currentTarget.value)
          }}
        />
        <Group justify="flex-end" gap="sm">
          <HintButton tooltip={strings.tooltips.cancelDialog} variant="default" onClick={onClose}>
            {strings.common.cancel}
          </HintButton>
          {/* Blocking is a routine, non-destructive flag — primary, not red. */}
          <HintButton
            tooltip={strings.tooltips.block}
            leftSection={<Ban size={16} aria-hidden />}
            onClick={() => {
              setTouched(true)
              const trimmed = reason.trim()
              if (trimmed === '') return
              onSubmit(trimmed)
            }}
          >
            {strings.blockAction.confirm}
          </HintButton>
        </Group>
      </Stack>
    </Modal>
  )
}
