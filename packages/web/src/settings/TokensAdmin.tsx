import { TOKEN_SCOPES, type TokenScope } from '@rivian-kanban/core'
import { Badge, Button, Group, Modal, Select, Stack, Table, Text, TextInput } from '@mantine/core'
import { Ban, Plus, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import {
  useCreateServiceToken,
  useRevokeServiceToken,
  useRotateServiceToken,
  useServiceTokens,
} from '../api/admin.ts'
import { type ServiceTokenView } from '../api/schemas.ts'
import { useUserTimezone } from '../auth/session-context.ts'
import { formatDateTime } from '../lib/format.ts'
import { ConfirmModal } from '../shell/ConfirmModal.tsx'
import { strings } from '../strings.ts'
import { RevealOnceModal } from './RevealOnceModal.tsx'
import { useRoleLabel, useRoleOptions } from './role-select-data.ts'

/** MCP service tokens: create (raw `rkb_…` shown once), rotate, and revoke. */
export function TokensAdmin() {
  const tokens = useServiceTokens()
  const createToken = useCreateServiceToken()
  const revokeToken = useRevokeServiceToken()
  const rotateToken = useRotateServiceToken()
  const timezone = useUserTimezone()
  const roleOptions = useRoleOptions()
  const roleLabel = useRoleLabel()
  const [createOpen, setCreateOpen] = useState(false)
  // `rawToken` is the shared reveal-once state — create AND rotate both feed it.
  const [rawToken, setRawToken] = useState<string | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<ServiceTokenView | null>(null)
  const [rotateTarget, setRotateTarget] = useState<ServiceTokenView | null>(null)
  const [draft, setDraft] = useState<{ name: string; role: string; scope: TokenScope }>({
    name: '',
    role: 'user',
    scope: 'read',
  })

  return (
    <Stack gap="md">
      <Group justify="flex-end">
        <Button
          size="sm"
          leftSection={<Plus size={16} aria-hidden />}
          onClick={() => {
            setCreateOpen(true)
          }}
        >
          {strings.tokens.createButton}
        </Button>
      </Group>
      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{strings.tokens.nameLabel}</Table.Th>
            <Table.Th>{strings.tokens.roleLabel}</Table.Th>
            <Table.Th>{strings.tokens.scopeLabel}</Table.Th>
            <Table.Th>{strings.tokens.lastUsed}</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {tokens.data?.length === 0 ? (
            <Table.Tr>
              <Table.Td colSpan={5}>
                <Text size="sm" c="dimmed">
                  {strings.tokens.empty}
                </Text>
              </Table.Td>
            </Table.Tr>
          ) : null}
          {(tokens.data ?? []).map((token) => (
            <Table.Tr key={token.id}>
              <Table.Td>
                <Text size="sm">{token.name}</Text>
              </Table.Td>
              <Table.Td>
                <Text size="sm">{roleLabel(token.role)}</Text>
              </Table.Td>
              <Table.Td>
                <Text size="sm">{strings.tokens.scopes[token.scope]}</Text>
              </Table.Td>
              <Table.Td>
                <Text size="sm">
                  {token.lastUsedAt === null
                    ? strings.tokens.neverUsed
                    : formatDateTime(token.lastUsedAt, timezone)}
                </Text>
              </Table.Td>
              <Table.Td>
                {token.revokedAt !== null ? (
                  <Badge color="gray" variant="light" size="sm">
                    {strings.tokens.revoked}
                  </Badge>
                ) : (
                  <Group gap="xs" justify="flex-end" wrap="nowrap">
                    <Button
                      size="compact-xs"
                      variant="light"
                      leftSection={<RefreshCw size={14} aria-hidden />}
                      onClick={() => {
                        setRotateTarget(token)
                      }}
                    >
                      {strings.tokens.rotate}
                    </Button>
                    <Button
                      size="compact-xs"
                      variant="light"
                      color="red"
                      leftSection={<Ban size={14} aria-hidden />}
                      onClick={() => {
                        setRevokeTarget(token)
                      }}
                    >
                      {strings.tokens.revoke}
                    </Button>
                  </Group>
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      {createOpen ? (
        <Modal
          opened
          onClose={() => {
            setCreateOpen(false)
          }}
          title={strings.tokens.createTitle}
          centered
        >
          <Stack gap="md">
            <TextInput
              label={strings.tokens.nameLabel}
              value={draft.name}
              onChange={(event) => {
                setDraft({ ...draft, name: event.currentTarget.value })
              }}
            />
            <Select
              label={strings.tokens.roleLabel}
              data={roleOptions}
              value={draft.role}
              allowDeselect={false}
              onChange={(role) => {
                if (role !== null) setDraft({ ...draft, role: role })
              }}
            />
            <Select
              label={strings.tokens.scopeLabel}
              data={TOKEN_SCOPES.map((scope) => ({
                value: scope,
                label: strings.tokens.scopes[scope],
              }))}
              value={draft.scope}
              allowDeselect={false}
              onChange={(scope) => {
                if (scope !== null) setDraft({ ...draft, scope: scope })
              }}
            />
            <Group justify="flex-end">
              <Button
                loading={createToken.isPending}
                leftSection={<Plus size={16} aria-hidden />}
                disabled={draft.name.trim() === ''}
                onClick={() => {
                  createToken.mutate(draft, {
                    onSuccess: (created) => {
                      setCreateOpen(false)
                      setDraft({ name: '', role: 'user', scope: 'read' })
                      setRawToken(created.rawToken)
                    },
                  })
                }}
              >
                {strings.common.create}
              </Button>
            </Group>
          </Stack>
        </Modal>
      ) : null}

      {rawToken !== null ? (
        <RevealOnceModal
          title={strings.tokens.tokenTitle}
          hint={strings.tokens.tokenHint}
          secret={rawToken}
          onClose={() => {
            setRawToken(null)
          }}
        />
      ) : null}

      {revokeTarget !== null ? (
        <ConfirmModal
          title={strings.tokens.revokeConfirmTitle}
          body={strings.tokens.revokeConfirmBody(revokeTarget.name)}
          confirmLabel={strings.tokens.revokeConfirm}
          loading={revokeToken.isPending}
          onConfirm={() => {
            revokeToken.mutate(revokeTarget.id, {
              onSuccess: () => {
                setRevokeTarget(null)
              },
            })
          }}
          onClose={() => {
            setRevokeTarget(null)
          }}
        />
      ) : null}

      {rotateTarget !== null ? (
        <ConfirmModal
          title={strings.tokens.rotateConfirmTitle}
          body={strings.tokens.rotateConfirmBody(rotateTarget.name)}
          confirmLabel={strings.tokens.rotateConfirm}
          loading={rotateToken.isPending}
          onConfirm={() => {
            rotateToken.mutate(rotateTarget.id, {
              // Reuse the create reveal flow: the new secret lands in the
              // same reveal-once dialog (Copy button included).
              onSuccess: (rotated) => {
                setRotateTarget(null)
                setRawToken(rotated.rawToken)
              },
            })
          }}
          onClose={() => {
            setRotateTarget(null)
          }}
        />
      ) : null}
    </Stack>
  )
}
