import { Group, Modal, Stack, Text } from '@mantine/core'
import { X } from 'lucide-react'
import { HintButton } from './HintButton.tsx'
import { strings } from '../strings.ts'

export interface ConfirmModalProps {
  title: string
  body: string
  confirmLabel: string
  /** Always-on hint for the confirm button; falls back to the label. */
  confirmHint?: string
  /** Red confirm for destructive actions; default for the rest. */
  destructive?: boolean
  loading?: boolean
  onConfirm: () => void
  onClose: () => void
}

/**
 * A small yes/no confirmation dialog — the guardrail for destructive or
 * hard-to-undo actions (delete location, revoke token, delete comment) so a
 * single mis-click can never wipe data without a prompt.
 */
export function ConfirmModal({
  title,
  body,
  confirmLabel,
  confirmHint,
  destructive = true,
  loading = false,
  onConfirm,
  onClose,
}: ConfirmModalProps) {
  return (
    <Modal opened onClose={onClose} title={title} centered>
      <Stack gap="md">
        <Text size="sm">{body}</Text>
        <Group justify="flex-end" gap="sm">
          <HintButton
            variant="default"
            tooltip={strings.tooltips.cancelDialog}
            leftSection={<X size={16} aria-hidden />}
            onClick={onClose}
          >
            {strings.common.cancel}
          </HintButton>
          <HintButton
            {...(destructive ? { color: 'red' } : {})}
            tooltip={confirmHint ?? confirmLabel}
            loading={loading}
            onClick={onConfirm}
          >
            {confirmLabel}
          </HintButton>
        </Group>
      </Stack>
    </Modal>
  )
}
