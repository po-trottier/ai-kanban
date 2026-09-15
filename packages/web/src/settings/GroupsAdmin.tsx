import { type Group, type GroupInput } from '@rivian-kanban/core'
import {
  ActionIcon,
  Group as MantineGroup,
  Modal,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useCreateGroup, useDeleteGroup, useGroups, useUpdateGroup } from '../api/groups.ts'
import { isConflictError } from '../api/problem.ts'
import { AsyncUserMultiSelect } from '../shell/AsyncUserPicker.tsx'
import { ConfirmModal } from '../shell/ConfirmModal.tsx'
import { HintButton } from '../shell/HintButton.tsx'
import { SkeletonRows } from '../shell/SkeletonRows.tsx'
import { strings } from '../strings.ts'

/** Settings → Groups, admin-only. Boards grant access by role OR group OR person. */
export function GroupsAdmin() {
  const groups = useGroups()
  const [editing, setEditing] = useState<Group | 'new' | null>(null)

  return (
    <Stack gap="md">
      <MantineGroup justify="space-between" align="flex-start" wrap="nowrap">
        <Text c="dimmed" size="sm" flex={1} miw={0}>
          {strings.groups.intro}
        </Text>
        <HintButton
          tooltip={strings.tooltips.addGroup}
          leftSection={<Plus size={16} aria-hidden />}
          onClick={() => {
            setEditing('new')
          }}
        >
          {strings.groups.addButton}
        </HintButton>
      </MantineGroup>
      <Table layout="fixed">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{strings.groups.nameLabel}</Table.Th>
            <Table.Th>{strings.groups.membersLabel}</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {groups.isPending ? <SkeletonRows rows={3} cols={3} /> : null}
          {(groups.data ?? []).map((group) => (
            <GroupRow
              key={group.id}
              group={group}
              onEdit={() => {
                setEditing(group)
              }}
            />
          ))}
        </Table.Tbody>
      </Table>
      {editing !== null ? (
        <GroupFormModal
          group={editing === 'new' ? null : editing}
          onClose={() => {
            setEditing(null)
          }}
        />
      ) : null}
    </Stack>
  )
}

function GroupRow({ group, onEdit }: { group: Group; onEdit: () => void }) {
  const deleteGroup = useDeleteGroup()
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const inUse = isConflictError(deleteGroup.error)

  return (
    <Table.Tr>
      <Table.Td>
        <Text size="sm" style={{ overflowWrap: 'anywhere' }}>
          {group.name}
        </Text>
      </Table.Td>
      <Table.Td>
        <Text size="sm" c="dimmed">
          {group.userIds.length}
        </Text>
      </Table.Td>
      <Table.Td>
        <MantineGroup gap="xs" wrap="nowrap" justify="flex-end">
          <Tooltip label={strings.tooltips.saveGroup}>
            <ActionIcon
              variant="subtle"
              color="gray"
              aria-label={`${strings.common.edit} (${group.name})`}
              onClick={onEdit}
            >
              <Pencil size={16} aria-hidden />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={strings.tooltips.deleteGroup}>
            <ActionIcon
              variant="subtle"
              color="red"
              aria-label={`${strings.tooltips.deleteGroup} (${group.name})`}
              loading={deleteGroup.isPending}
              onClick={() => {
                setConfirmingDelete(true)
              }}
            >
              <Trash2 size={16} aria-hidden />
            </ActionIcon>
          </Tooltip>
        </MantineGroup>
        {confirmingDelete ? (
          <ConfirmModal
            title={strings.groups.deleteConfirmTitle}
            body={inUse ? strings.groups.inUse : strings.groups.deleteConfirmBody(group.name)}
            confirmLabel={strings.groups.deleteConfirmLabel}
            loading={deleteGroup.isPending}
            onConfirm={() => {
              deleteGroup.mutate(group.id, {
                onSuccess: () => {
                  setConfirmingDelete(false)
                },
              })
            }}
            onClose={() => {
              setConfirmingDelete(false)
            }}
          />
        ) : null}
      </Table.Td>
    </Table.Tr>
  )
}

function GroupFormModal({ group, onClose }: { group: Group | null; onClose: () => void }) {
  const createGroup = useCreateGroup()
  const updateGroup = useUpdateGroup()
  const [name, setName] = useState(group?.name ?? '')
  const [userIds, setUserIds] = useState<string[]>(group?.userIds ?? [])
  const saving = createGroup.isPending || updateGroup.isPending
  const canSubmit = name.trim() !== ''

  const submit = () => {
    const input: GroupInput = { name: name.trim(), userIds }
    const onSuccess = { onSuccess: onClose }
    if (group === null) createGroup.mutate(input, onSuccess)
    else updateGroup.mutate({ groupId: group.id, input }, onSuccess)
  }

  return (
    <Modal
      opened
      onClose={onClose}
      title={group === null ? strings.groups.addTitle : strings.groups.editTitle}
      centered
    >
      <Stack gap="md">
        <TextInput
          label={strings.groups.nameLabel}
          maxLength={80}
          data-autofocus
          value={name}
          error={name.trim() === '' ? strings.groups.nameRequired : null}
          onChange={(event) => {
            setName(event.currentTarget.value)
          }}
        />
        <Stack gap={4}>
          <Text size="sm" fw={500}>
            {strings.groups.membersLabel}
          </Text>
          <AsyncUserMultiSelect
            value={userIds}
            onChange={setUserIds}
            ariaLabel={strings.groups.membersLabel}
            placeholder={strings.groups.membersLabel}
          />
        </Stack>
        <MantineGroup justify="flex-end">
          <HintButton tooltip={strings.tooltips.cancelDialog} variant="default" onClick={onClose}>
            {strings.common.cancel}
          </HintButton>
          <HintButton
            tooltip={strings.tooltips.saveGroup}
            disabledReason={!canSubmit ? strings.groups.nameRequired : undefined}
            loading={saving}
            onClick={submit}
          >
            {group === null ? strings.common.create : strings.common.save}
          </HintButton>
        </MantineGroup>
      </Stack>
    </Modal>
  )
}
