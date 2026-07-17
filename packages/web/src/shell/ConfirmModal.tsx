import { Button, Group, Modal, Stack, Text } from '@mantine/core'
import { strings } from '../strings.ts'

export interface ConfirmModalProps {
  title: string
  body: string
  confirmLabel: string
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
          <Button variant="default" onClick={onClose}>
            {strings.common.cancel}
          </Button>
          <Button {...(destructive ? { color: 'red' } : {})} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
