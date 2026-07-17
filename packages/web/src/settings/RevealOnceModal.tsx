import { Code, Modal, Stack, Text } from '@mantine/core'

interface RevealOnceModalProps {
  title: string
  hint: string
  secret: string
  onClose: () => void
}

/**
 * The "shown exactly once" secret modal shared by the admin screens: the
 * one-time temp password (UsersAdmin) and the raw `rkb_…` service-token
 * credential (TokensAdmin) present identically — only the wording differs.
 */
export function RevealOnceModal({ title, hint, secret, onClose }: RevealOnceModalProps) {
  return (
    <Modal opened onClose={onClose} title={title}>
      <Stack gap="md">
        <Code block>{secret}</Code>
        <Text size="sm" c="dimmed">
          {hint}
        </Text>
      </Stack>
    </Modal>
  )
}
