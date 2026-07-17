import { ROLES, TOKEN_SCOPES, type Role, type TokenScope } from '@rivian-kanban/core'
import {
  Badge,
  Button,
  Code,
  Group,
  Modal,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core'
import { useState } from 'react'
import { useCreateServiceToken, useRevokeServiceToken, useServiceTokens } from '../api/admin.ts'
import { formatDateTime } from '../lib/format.ts'
import { strings } from '../strings.ts'

/** MCP service tokens: create (raw `rkb_…` shown once) and revoke. */
export function TokensAdmin() {
  const tokens = useServiceTokens()
  const createToken = useCreateServiceToken()
  const revokeToken = useRevokeServiceToken()
  const [createOpen, setCreateOpen] = useState(false)
  const [rawToken, setRawToken] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ name: string; role: Role; scope: TokenScope }>({
    name: '',
    role: 'technician',
    scope: 'read',
  })

  return (
    <Stack gap="md">
      <Group justify="flex-end">
        <Button
          size="sm"
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
          {(tokens.data ?? []).map((token) => (
            <Table.Tr key={token.id}>
              <Table.Td>
                <Text size="sm">{token.name}</Text>
              </Table.Td>
              <Table.Td>
                <Text size="sm">{strings.users.roles[token.role]}</Text>
              </Table.Td>
              <Table.Td>
                <Text size="sm">{strings.tokens.scopes[token.scope]}</Text>
              </Table.Td>
              <Table.Td>
                <Text size="sm">
                  {token.lastUsedAt === null
                    ? strings.tokens.neverUsed
                    : formatDateTime(token.lastUsedAt)}
                </Text>
              </Table.Td>
              <Table.Td>
                {token.revokedAt !== null ? (
                  <Badge color="gray" variant="light" size="sm">
                    {strings.tokens.revoked}
                  </Badge>
                ) : (
                  <Button
                    size="compact-xs"
                    variant="light"
                    color="red"
                    onClick={() => {
                      revokeToken.mutate(token.id)
                    }}
                  >
                    {strings.tokens.revoke}
                  </Button>
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
              data={ROLES.map((role) => ({ value: role, label: strings.users.roles[role] }))}
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
                disabled={draft.name.trim() === ''}
                onClick={() => {
                  createToken.mutate(draft, {
                    onSuccess: (created) => {
                      setCreateOpen(false)
                      setDraft({ name: '', role: 'technician', scope: 'read' })
                      setRawToken(created.token)
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
        <Modal
          opened
          onClose={() => {
            setRawToken(null)
          }}
          title={strings.tokens.tokenTitle}
        >
          <Stack gap="md">
            <Code block>{rawToken}</Code>
            <Text size="sm" c="dimmed">
              {strings.tokens.tokenHint}
            </Text>
          </Stack>
        </Modal>
      ) : null}
    </Stack>
  )
}
