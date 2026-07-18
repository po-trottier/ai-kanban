import { Button, Code, CopyButton, Group, Modal, Stack, Text } from '@mantine/core'
import { Check, Copy } from 'lucide-react'
import { strings } from '../strings.ts'

interface RevealOnceModalProps {
  title: string
  hint: string
  secret: string
  onClose: () => void
}

const COPY_ICON_SIZE = 16

/**
 * The "shown exactly once" secret modal shared by the admin screens: the
 * one-time temp password (UsersAdmin) and the raw `rkb_…` service-token
 * credential (TokensAdmin) present identically — only the wording differs.
 * A one-click Copy button (it is the only chance to grab the secret) flips to
 * a confirmed "Copied" state via Mantine's clipboard helper.
 */
export function RevealOnceModal({ title, hint, secret, onClose }: RevealOnceModalProps) {
  return (
    <Modal opened onClose={onClose} title={title} centered>
      <Stack gap="md">
        <Code block>{secret}</Code>
        <Group justify="space-between" align="center" gap="sm" wrap="nowrap">
          <Text size="sm" c="dimmed">
            {hint}
          </Text>
          <CopyButton value={secret} timeout={2000}>
            {({ copied, copy }) => (
              <Button
                variant={copied ? 'light' : 'default'}
                {...(copied ? { color: 'teal' } : {})}
                leftSection={
                  copied ? (
                    <Check size={COPY_ICON_SIZE} aria-hidden />
                  ) : (
                    <Copy size={COPY_ICON_SIZE} aria-hidden />
                  )
                }
                onClick={copy}
                style={{ flexShrink: 0 }}
              >
                {copied ? strings.common.copied : strings.common.copy}
              </Button>
            )}
          </CopyButton>
        </Group>
      </Stack>
    </Modal>
  )
}
