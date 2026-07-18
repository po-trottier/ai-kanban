import { CANCEL_RESOLUTIONS, type CancelResolution } from '@rivian-kanban/core'
import { Group, Modal, Select, Stack, Text } from '@mantine/core'
import { useState } from 'react'
import { HintButton } from '../shell/HintButton.tsx'
import { strings } from '../strings.ts'

export interface CancelCardModalProps {
  onSubmit: (resolution: CancelResolution) => void
  onClose: () => void
}

/** Cancelling is an explicit action, never a drag (docs/product/workflow.md). */
export function CancelCardModal({ onSubmit, onClose }: CancelCardModalProps) {
  const [resolution, setResolution] = useState<CancelResolution>('cancelled')

  return (
    <Modal opened onClose={onClose} title={strings.cancelAction.modalTitle} centered>
      <Stack gap="md">
        <Select
          label={strings.cancelAction.resolutionLabel}
          data={CANCEL_RESOLUTIONS.map((value) => ({
            value,
            label: strings.cancelAction.resolutions[value],
          }))}
          value={resolution}
          allowDeselect={false}
          onChange={(value) => {
            if (value !== null) setResolution(value)
          }}
        />
        {/* Explains the consequence: a cancelled card leaves the active board. */}
        <Text size="sm" c="dimmed">
          {strings.cancelAction.consequence(strings.cancelAction.resolutions[resolution])}
        </Text>
        <Group justify="flex-end" gap="sm">
          <HintButton tooltip={strings.tooltips.cancelDialog} variant="default" onClick={onClose}>
            {strings.common.cancel}
          </HintButton>
          <HintButton
            tooltip={strings.tooltips.cancelCard}
            color="red"
            onClick={() => {
              onSubmit(resolution)
            }}
          >
            {strings.cancelAction.confirm}
          </HintButton>
        </Group>
      </Stack>
    </Modal>
  )
}
