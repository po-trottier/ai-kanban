import { type Role } from '@rivian-kanban/core'
import { Button, Group, Modal, Select, Stack, Table, Text, TextInput } from '@mantine/core'
import { useState } from 'react'
import { useCreateUser, usePatchUser } from '../api/admin.ts'
import { useUsers } from '../api/meta.ts'
import { strings } from '../strings.ts'
import { RevealOnceModal } from './RevealOnceModal.tsx'
import { ROLE_SELECT_DATA } from './role-select-data.ts'

/** User administration: create, role change, reset password, deactivate. */
export function UsersAdmin() {
  const users = useUsers()
  const createUser = useCreateUser()
  const patchUser = usePatchUser()
  const [createOpen, setCreateOpen] = useState(false)
  const [tempPassword, setTempPassword] = useState<string | null>(null)
  const [draft, setDraft] = useState({ email: '', displayName: '', role: 'user' as Role })
  // Deactivation is one-way in the UI (GET /users lists only active users), so it confirms.
  const [deactivating, setDeactivating] = useState<{ id: string; name: string } | null>(null)

  const showTempPassword = (password: string | undefined) => {
    if (password !== undefined) setTempPassword(password)
  }

  return (
    <Stack gap="md">
      <Group justify="flex-end">
        <Button
          size="sm"
          onClick={() => {
            setCreateOpen(true)
          }}
        >
          {strings.users.createButton}
        </Button>
      </Group>
      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{strings.users.nameLabel}</Table.Th>
            <Table.Th>{strings.users.emailLabel}</Table.Th>
            <Table.Th>{strings.users.roleLabel}</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {(users.data ?? []).map((user) => (
            <Table.Tr key={user.id}>
              <Table.Td>
                <Text size="sm">{user.displayName}</Text>
              </Table.Td>
              <Table.Td>
                {/* Present only on admin reads of GET /users. */}
                <Text size="sm" c="dimmed">
                  {user.email ?? strings.common.notAvailable}
                </Text>
              </Table.Td>
              <Table.Td>
                <Select
                  aria-label={`${strings.users.roleLabel}: ${user.displayName}`}
                  size="xs"
                  data={ROLE_SELECT_DATA}
                  value={user.role}
                  allowDeselect={false}
                  onChange={(role) => {
                    if (role !== null) {
                      patchUser.mutate({ userId: user.id, input: { role: role } })
                    }
                  }}
                />
              </Table.Td>
              <Table.Td>
                <Group gap="xs" justify="flex-end">
                  <Button
                    size="compact-xs"
                    variant="light"
                    onClick={() => {
                      patchUser.mutate(
                        { userId: user.id, input: { resetPassword: true } },
                        {
                          onSuccess: (response) => {
                            showTempPassword(response.tempPassword)
                          },
                        },
                      )
                    }}
                  >
                    {strings.users.resetPassword}
                  </Button>
                  <Button
                    size="compact-xs"
                    variant="light"
                    color="red"
                    onClick={() => {
                      setDeactivating({ id: user.id, name: user.displayName })
                    }}
                  >
                    {strings.users.deactivate}
                  </Button>
                </Group>
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
          title={strings.users.createTitle}
          centered
        >
          <Stack gap="md">
            <TextInput
              label={strings.users.nameLabel}
              value={draft.displayName}
              onChange={(event) => {
                setDraft({ ...draft, displayName: event.currentTarget.value })
              }}
            />
            <TextInput
              label={strings.users.emailLabel}
              type="email"
              value={draft.email}
              onChange={(event) => {
                setDraft({ ...draft, email: event.currentTarget.value })
              }}
            />
            <Select
              label={strings.users.roleLabel}
              data={ROLE_SELECT_DATA}
              value={draft.role}
              allowDeselect={false}
              onChange={(role) => {
                if (role !== null) setDraft({ ...draft, role: role })
              }}
            />
            <Group justify="flex-end">
              <Button
                loading={createUser.isPending}
                disabled={draft.displayName.trim() === '' || draft.email.trim() === ''}
                onClick={() => {
                  createUser.mutate(draft, {
                    onSuccess: (response) => {
                      setCreateOpen(false)
                      setDraft({ email: '', displayName: '', role: 'user' })
                      showTempPassword(response.tempPassword)
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

      {deactivating !== null ? (
        <Modal
          opened
          onClose={() => {
            setDeactivating(null)
          }}
          title={strings.users.deactivateConfirmTitle}
          centered
        >
          <Stack gap="md">
            <Text size="sm">{strings.users.deactivateConfirmBody(deactivating.name)}</Text>
            <Group justify="flex-end" gap="sm">
              <Button
                variant="default"
                onClick={() => {
                  setDeactivating(null)
                }}
              >
                {strings.common.cancel}
              </Button>
              <Button
                color="red"
                onClick={() => {
                  patchUser.mutate({ userId: deactivating.id, input: { isActive: false } })
                  setDeactivating(null)
                }}
              >
                {strings.users.deactivate}
              </Button>
            </Group>
          </Stack>
        </Modal>
      ) : null}

      {tempPassword !== null ? (
        <RevealOnceModal
          title={strings.users.tempPasswordTitle}
          hint={strings.users.tempPasswordHint}
          secret={tempPassword}
          onClose={() => {
            setTempPassword(null)
          }}
        />
      ) : null}
    </Stack>
  )
}
