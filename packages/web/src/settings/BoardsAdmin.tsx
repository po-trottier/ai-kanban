import { type Board, type BoardInput } from '@rivian-kanban/core'
import {
  ActionIcon,
  Badge,
  Checkbox,
  Divider,
  Group,
  Modal,
  MultiSelect,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'

import {
  useBoardCatalog,
  useCreateBoard,
  useDeleteBoard,
  useUpdateBoard,
  useSetBoardPreference,
} from '../api/boards.ts'
import { useGroups } from '../api/groups.ts'
import { usePolicy } from '../api/meta.ts'
import { AsyncUserMultiSelect } from '../shell/AsyncUserPicker.tsx'
import { ConfirmModal } from '../shell/ConfirmModal.tsx'
import { HintButton } from '../shell/HintButton.tsx'
import { SkeletonRows } from '../shell/SkeletonRows.tsx'
import { strings } from '../strings.ts'

type AccessMode = 'all' | 'restricted'

/**
 * Settings → Boards: personal preferences for everyone, management gated by
 * the catalog's `canManage`. Create/edit share one form (name, all-vs-restricted
 * access, roles OR groups OR people); delete archives (work orders + history
 * kept) and is blocked on the last active board (mirrors `LanesAdmin`).
 */
export function BoardsAdmin() {
  const catalog = useBoardCatalog()
  const boards = catalog.data?.items ?? []
  const canManage = catalog.data?.canManage ?? false
  const globalDefaultId = catalog.data?.defaultAssignments.find(
    (assignment) => assignment.scope === 'application',
  )?.boardId
  const preference = useSetBoardPreference()
  const [editing, setEditing] = useState<Board | 'new' | null>(null)

  return (
    <Stack gap="md">
      <Select
        label={strings.boards.preferredDefault}
        description={strings.boards.preferredDefaultHelp}
        data={[
          { value: 'assigned', label: strings.boards.useAssignedDefault },
          ...boards.map((board) => ({ value: board.id, label: board.name })),
        ]}
        value={catalog.data?.preferredBoardId ?? 'assigned'}
        allowDeselect={false}
        disabled={catalog.isPending || preference.isPending}
        onChange={(value) => {
          if (value !== null) preference.mutate(value === 'assigned' ? null : value)
        }}
      />
      <Text size="sm" c="dimmed">
        {strings.boards.opensByDefault(
          boards.find((board) => board.id === catalog.data?.defaultBoardId)?.name ??
            strings.boards.empty,
        )}
      </Text>
      {!catalog.isPending && boards.length === 0 ? (
        <Text size="sm" c="dimmed">
          {strings.boards.emptyHint}
        </Text>
      ) : null}
      <Divider />
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Text c="dimmed" size="sm" flex={1} miw={0}>
          {canManage ? strings.boards.intro : strings.boards.readOnlyHelp}
        </Text>
        {canManage ? (
          <HintButton
            tooltip={strings.tooltips.addBoard}
            leftSection={<Plus size={16} aria-hidden />}
            onClick={() => {
              setEditing('new')
            }}
          >
            {strings.boards.addButton}
          </HintButton>
        ) : null}
      </Group>
      <Table layout="fixed">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{strings.boards.nameLabel}</Table.Th>
            <Table.Th>{strings.boards.accessModeLabel}</Table.Th>
            {canManage ? <Table.Th /> : null}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {catalog.isPending ? <SkeletonRows rows={3} cols={3} /> : null}
          {boards.map((board) => (
            <BoardRow
              key={board.id}
              board={board}
              canManage={canManage}
              isGlobalDefault={globalDefaultId === board.id}
              isResolvedDefault={catalog.data?.defaultBoardId === board.id}
              isLastBoard={boards.length <= 1}
              onEdit={() => {
                setEditing(board)
              }}
            />
          ))}
        </Table.Tbody>
      </Table>
      {editing !== null ? (
        <BoardFormModal
          board={editing === 'new' ? null : editing}
          onClose={() => {
            setEditing(null)
          }}
        />
      ) : null}
    </Stack>
  )
}

function BoardRow({
  board,
  canManage,
  isGlobalDefault,
  isResolvedDefault,
  isLastBoard,
  onEdit,
}: {
  board: Board
  canManage: boolean
  isGlobalDefault: boolean
  isResolvedDefault: boolean
  isLastBoard: boolean
  onEdit: () => void
}) {
  const deleteBoard = useDeleteBoard()
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const disableDelete = isLastBoard || deleteBoard.isPending

  return (
    <Table.Tr>
      <Table.Td>
        <Group gap="xs">
          <Text size="sm" style={{ overflowWrap: 'anywhere' }}>
            {board.name}
          </Text>
          {isGlobalDefault ? (
            <Tooltip label={strings.boards.defaultBadgeHelp}>
              <Badge size="xs" variant="light" color="gray">
                {strings.boards.defaultBadge}
              </Badge>
            </Tooltip>
          ) : isResolvedDefault ? (
            <Badge size="xs" variant="outline" color="gray">
              {strings.boards.resolvedDefaultBadge}
            </Badge>
          ) : null}
        </Group>
      </Table.Td>
      <Table.Td>
        <Text size="sm" c="dimmed">
          {board.accessMode === 'all'
            ? strings.boards.accessModeAll
            : strings.boards.accessModeRestricted}
        </Text>
      </Table.Td>
      {canManage ? (
        <Table.Td>
          <Group gap="xs" wrap="nowrap" justify="flex-end">
            <Tooltip label={strings.tooltips.saveBoard}>
              <ActionIcon
                variant="subtle"
                color="gray"
                aria-label={`${strings.common.edit} (${board.name})`}
                onClick={onEdit}
              >
                <Pencil size={16} aria-hidden />
              </ActionIcon>
            </Tooltip>
            <Tooltip
              label={isLastBoard ? strings.tooltips.deleteLastBoard : strings.tooltips.deleteBoard}
            >
              <span>
                <ActionIcon
                  variant="subtle"
                  color="red"
                  aria-label={`${strings.tooltips.deleteBoard} (${board.name})`}
                  disabled={disableDelete}
                  loading={deleteBoard.isPending}
                  onClick={() => {
                    setConfirmingDelete(true)
                  }}
                >
                  <Trash2 size={16} aria-hidden />
                </ActionIcon>
              </span>
            </Tooltip>
          </Group>
          {confirmingDelete ? (
            <ConfirmModal
              title={strings.boards.deleteConfirmTitle}
              body={strings.boards.deleteConfirmBody(board.name)}
              confirmLabel={strings.boards.deleteConfirmLabel}
              loading={deleteBoard.isPending}
              onConfirm={() => {
                deleteBoard.mutate(board.id, {
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
      ) : null}
    </Table.Tr>
  )
}

function BoardFormModal({ board, onClose }: { board: Board | null; onClose: () => void }) {
  const catalog = useBoardCatalog()
  const policy = usePolicy()
  const groups = useGroups()
  const createBoard = useCreateBoard()
  const updateBoard = useUpdateBoard()
  const [name, setName] = useState(board?.name ?? '')
  const [accessMode, setAccessMode] = useState<AccessMode>(board?.accessMode ?? 'all')
  const [allowedRoleKeys, setAllowedRoleKeys] = useState<string[]>(board?.allowedRoleKeys ?? [])
  const [allowedGroupIds, setAllowedGroupIds] = useState<string[]>(board?.allowedGroupIds ?? [])
  const [allowedUserIds, setAllowedUserIds] = useState<string[]>(board?.allowedUserIds ?? [])
  const existingDefaults = (catalog.data?.defaultAssignments ?? []).filter(
    (row) => row.boardId === board?.id,
  )
  const [defaultAssignments, setDefaultAssignments] = useState({
    application: existingDefaults.some((row) => row.scope === 'application'),
    roleKeys: existingDefaults.filter((row) => row.scope === 'role').map((row) => row.subject),
    groupIds: existingDefaults.filter((row) => row.scope === 'group').map((row) => row.subject),
  })

  const roleOptions = (policy.data?.roles ?? []).map((role) => ({
    value: role.key,
    label: role.name,
  }))
  const groupOptions = (groups.data ?? []).map((group) => ({
    value: group.id,
    label: group.name,
  }))
  const saving = createBoard.isPending || updateBoard.isPending
  const canSubmit = name.trim() !== ''

  const submit = () => {
    const input: BoardInput = {
      defaultAssignments,
      name: name.trim(),
      accessMode,
      allowedRoleKeys: accessMode === 'restricted' ? allowedRoleKeys : [],
      allowedGroupIds: accessMode === 'restricted' ? allowedGroupIds : [],
      allowedUserIds: accessMode === 'restricted' ? allowedUserIds : [],
    }
    const onSuccess = { onSuccess: onClose }
    if (board === null) createBoard.mutate(input, onSuccess)
    else updateBoard.mutate({ boardId: board.id, input }, onSuccess)
  }

  return (
    <Modal
      opened
      onClose={onClose}
      title={board === null ? strings.boards.addTitle : strings.boards.editTitle}
      centered
    >
      <Stack gap="md">
        <TextInput
          label={strings.boards.nameLabel}
          maxLength={80}
          data-autofocus
          value={name}
          error={name.trim() === '' ? strings.boards.nameRequired : null}
          onChange={(event) => {
            setName(event.currentTarget.value)
          }}
        />
        <Stack gap={4}>
          <Text size="sm" fw={500}>
            {strings.boards.accessModeLabel}
          </Text>
          <SegmentedControl
            value={accessMode}
            onChange={(value) => {
              setAccessMode(value === 'restricted' ? 'restricted' : 'all')
            }}
            data={[
              { value: 'all', label: strings.boards.accessModeAll },
              { value: 'restricted', label: strings.boards.accessModeRestricted },
            ]}
          />
        </Stack>
        {accessMode === 'restricted' ? (
          <>
            <MultiSelect
              searchable
              label={strings.boards.rolesLabel}
              description={strings.boards.rolesHelp}
              data={roleOptions}
              value={allowedRoleKeys}
              onChange={setAllowedRoleKeys}
              comboboxProps={{ withinPortal: true }}
            />
            <MultiSelect
              searchable
              label={strings.boards.groupsLabel}
              description={strings.boards.groupsHelp}
              data={groupOptions}
              value={allowedGroupIds}
              onChange={setAllowedGroupIds}
              comboboxProps={{ withinPortal: true }}
            />
            <Stack gap={4}>
              <Text size="sm" fw={500}>
                {strings.boards.peopleLabel}
              </Text>
              <Text size="xs" c="dimmed">
                {strings.boards.peopleHelp}
              </Text>
              <AsyncUserMultiSelect
                value={allowedUserIds}
                onChange={setAllowedUserIds}
                ariaLabel={strings.boards.peopleLabel}
                placeholder={strings.boards.peopleLabel}
              />
            </Stack>
            {allowedRoleKeys.length === 0 &&
            allowedGroupIds.length === 0 &&
            allowedUserIds.length === 0 ? (
              <Text size="xs" c="dimmed">
                {strings.boards.restrictedEmptyHint}
              </Text>
            ) : null}
          </>
        ) : null}
        <Divider label={strings.boards.defaultAssignments} />
        <Text size="xs" c="dimmed">
          {strings.boards.defaultAssignmentsHelp}
        </Text>
        <Checkbox
          label={strings.boards.globalDefault}
          checked={defaultAssignments.application}
          onChange={(event) => {
            const application = event.currentTarget.checked
            setDefaultAssignments((current) => ({ ...current, application }))
          }}
        />
        <MultiSelect
          searchable
          label={strings.boards.defaultRoles}
          data={roleOptions}
          value={defaultAssignments.roleKeys}
          onChange={(roleKeys) => {
            setDefaultAssignments((current) => ({ ...current, roleKeys }))
          }}
        />
        <MultiSelect
          searchable
          label={strings.boards.defaultGroups}
          data={groupOptions}
          value={defaultAssignments.groupIds}
          onChange={(groupIds) => {
            setDefaultAssignments((current) => ({ ...current, groupIds }))
          }}
        />
        <Group justify="flex-end">
          <HintButton tooltip={strings.tooltips.cancelDialog} variant="default" onClick={onClose}>
            {strings.common.cancel}
          </HintButton>
          <HintButton
            tooltip={strings.tooltips.saveBoard}
            disabledReason={!canSubmit ? strings.boards.nameRequired : undefined}
            loading={saving}
            onClick={submit}
          >
            {board === null ? strings.common.create : strings.common.save}
          </HintButton>
        </Group>
      </Stack>
    </Modal>
  )
}
