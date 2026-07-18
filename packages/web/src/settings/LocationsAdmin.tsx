import { LOCATION_KINDS, type Location, type LocationKind } from '@rivian-kanban/core'
import { ActionIcon, Box, Group, Modal, Stack, Text, TextInput, Tooltip } from '@mantine/core'
import { DoorClosed, Layers, Pencil, Plus, Save, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useCreateLocation, useDeleteLocation, useRenameLocation } from '../api/admin.ts'
import { useLocations } from '../api/meta.ts'
import { isConflictError } from '../api/problem.ts'
import { buildLocationTree, type LocationTreeNode } from '../lib/location-tree.ts'
import { HintButton } from '../shell/HintButton.tsx'
import { strings } from '../strings.ts'
import { LocationKindIcon } from './location-kind-icon.tsx'
import classes from './locations.module.css'

type LocationModal =
  | { kind: 'none' }
  | { kind: 'add'; parent: Location | null }
  | { kind: 'rename'; location: Location }
  | { kind: 'delete'; location: Location; hasChildren: boolean }

/**
 * Location tree admin (buildings → floors → rooms): a clean, indented tree
 * that reads like the physical site, with kind icons, comfortable row spacing,
 * and per-node actions (add child / rename / delete) surfaced on hover with
 * tooltips. Delete confirms first (recursive subtree removal), and a friendly
 * empty state invites the first building.
 */
export function LocationsAdmin() {
  const locations = useLocations()
  const createLocation = useCreateLocation()
  const renameLocation = useRenameLocation()
  const deleteLocation = useDeleteLocation()
  const [modal, setModal] = useState<LocationModal>({ kind: 'none' })
  const [name, setName] = useState('')

  const tree = buildLocationTree(locations.data ?? [])

  const openAdd = (parent: Location | null) => {
    setName('')
    // Clear any lingering 409 from a prior add/rename so the field opens clean.
    createLocation.reset()
    renameLocation.reset()
    setModal({ kind: 'add', parent })
  }
  const openRename = (location: Location) => {
    setName(location.name)
    createLocation.reset()
    renameLocation.reset()
    setModal({ kind: 'rename', location })
  }
  const openDelete = (location: Location, hasChildren: boolean) => {
    setModal({ kind: 'delete', location, hasChildren })
  }
  const close = () => {
    setModal({ kind: 'none' })
  }

  // The active mutation for the open modal — its 409 surfaces as the inline
  // duplicate-name error beside the field (the toast is suppressed for 409).
  const nameMutation = modal.kind === 'rename' ? renameLocation : createLocation
  const nameError = isConflictError(nameMutation.error) ? strings.locations.duplicateName : null

  const setNameAndClearError = (next: string) => {
    setName(next)
    // A fresh keystroke retracts a stale duplicate-name error so the user sees
    // it clear the moment they start fixing the collision.
    if (nameMutation.error !== null) nameMutation.reset()
  }

  const submit = () => {
    const trimmed = name.trim()
    if (trimmed === '') return
    if (modal.kind === 'add') {
      createLocation.mutate(
        {
          parentId: modal.parent?.id ?? null,
          kind: childKind(modal.parent?.kind ?? null),
          name: trimmed,
        },
        { onSuccess: close },
      )
    } else if (modal.kind === 'rename') {
      renameLocation.mutate({ locationId: modal.location.id, name: trimmed }, { onSuccess: close })
    }
  }

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Text size="sm" c="dimmed" maw="40rem">
          {strings.locations.intro}
        </Text>
        {tree.length > 0 ? (
          // The empty state carries the primary "Add building" call to action,
          // so the header button appears only once there is a tree to add to.
          <HintButton
            tooltip={strings.tooltips.addBuilding}
            size="sm"
            leftSection={<Plus size="1rem" aria-hidden />}
            onClick={() => {
              openAdd(null)
            }}
          >
            {strings.locations.addRoot}
          </HintButton>
        ) : null}
      </Group>

      {tree.length === 0 ? (
        <EmptyState
          onAdd={() => {
            openAdd(null)
          }}
        />
      ) : (
        <Box role="tree" aria-label={strings.locations.treeLabel}>
          {tree.map((node) => (
            <LocationNode
              key={node.value}
              node={node}
              onAdd={openAdd}
              onRename={openRename}
              onDelete={openDelete}
            />
          ))}
        </Box>
      )}

      {modal.kind === 'add' || modal.kind === 'rename' ? (
        <Modal
          opened
          onClose={close}
          title={modal.kind === 'add' ? strings.locations.addTitle : strings.locations.renameTitle}
          centered
        >
          <Stack gap="md">
            <TextInput
              label={strings.locations.nameLabel}
              data-autofocus
              w="100%"
              value={name}
              error={nameError}
              onChange={(event) => {
                setNameAndClearError(event.currentTarget.value)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  submit()
                }
              }}
            />
            <Group justify="flex-end">
              <HintButton tooltip={strings.tooltips.cancelDialog} variant="default" onClick={close}>
                {strings.common.cancel}
              </HintButton>
              <HintButton
                tooltip={strings.tooltips.saveLocation}
                disabledReason={name.trim() === '' ? strings.tooltips.disabledEmptyName : undefined}
                loading={createLocation.isPending || renameLocation.isPending}
                leftSection={<Save size={16} aria-hidden />}
                onClick={submit}
              >
                {strings.common.save}
              </HintButton>
            </Group>
          </Stack>
        </Modal>
      ) : null}

      {modal.kind === 'delete' ? (
        <Modal opened onClose={close} title={strings.locations.deleteTitle} centered>
          <Stack gap="md">
            <Text size="sm" fw={600}>
              {strings.locations.deleteConfirmBody(modal.location.name)}
            </Text>
            <Text size="sm" c="dimmed">
              {modal.hasChildren
                ? strings.locations.deleteWarnsDescendants(modal.location.name)
                : strings.locations.deleteWarnsLeaf(modal.location.name)}
            </Text>
            <Group justify="flex-end">
              <HintButton tooltip={strings.tooltips.cancelDialog} variant="default" onClick={close}>
                {strings.common.cancel}
              </HintButton>
              <HintButton
                tooltip={strings.tooltips.setupRemoveConfirm}
                color="red"
                leftSection={<Trash2 size={16} aria-hidden />}
                loading={deleteLocation.isPending}
                onClick={() => {
                  deleteLocation.mutate(modal.location.id, { onSuccess: close })
                }}
              >
                {strings.locations.confirmDelete}
              </HintButton>
            </Group>
          </Stack>
        </Modal>
      ) : null}
    </Stack>
  )
}

/** One node plus its indented children, connected by a left guide rail. */
function LocationNode({
  node,
  onAdd,
  onRename,
  onDelete,
}: {
  node: LocationTreeNode
  onAdd: (parent: Location) => void
  onRename: (location: Location) => void
  onDelete: (location: Location, hasChildren: boolean) => void
}) {
  const hasChildren = node.children.length > 0
  return (
    <Box role="treeitem" aria-label={node.location.name}>
      <Group className={classes.row} gap="sm" wrap="nowrap">
        <LocationKindIcon kind={node.location.kind} />
        <Box>
          <Text size="sm" fw={500}>
            {node.location.name}
          </Text>
          <Text size="xs" c="dimmed">
            {strings.locations.kinds[node.location.kind]}
          </Text>
        </Box>
        <Group className={classes.actions} gap="xs" wrap="nowrap">
          {node.location.kind !== 'room' ? (
            <Tooltip label={addChildTooltip(node.location.kind)}>
              <ActionIcon
                variant="subtle"
                aria-label={strings.locations.addChildLabel(node.location.name)}
                onClick={() => {
                  onAdd(node.location)
                }}
              >
                <Plus size="1.1rem" aria-hidden />
              </ActionIcon>
            </Tooltip>
          ) : null}
          <Tooltip label={strings.locations.renameLabel(node.location.name)}>
            <ActionIcon
              variant="subtle"
              color="gray"
              aria-label={strings.locations.renameLabel(node.location.name)}
              onClick={() => {
                onRename(node.location)
              }}
            >
              <Pencil size="1.1rem" aria-hidden />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={strings.locations.deleteLabel(node.location.name)}>
            <ActionIcon
              variant="subtle"
              color="red"
              aria-label={strings.locations.deleteLabel(node.location.name)}
              onClick={() => {
                onDelete(node.location, hasChildren)
              }}
            >
              <Trash2 size="1.1rem" aria-hidden />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
      {hasChildren ? (
        <Box className={classes.children}>
          {node.children.map((child) => (
            <LocationNode
              key={child.value}
              node={child}
              onAdd={onAdd}
              onRename={onRename}
              onDelete={onDelete}
            />
          ))}
        </Box>
      ) : null}
    </Box>
  )
}

/** Friendly zero-state with an icon and a clear first action. */
function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <Stack align="center" gap="sm" py="xl">
      <Group gap="xs" c="dimmed">
        <Layers size="1.75rem" aria-hidden />
        <DoorClosed size="1.75rem" aria-hidden />
      </Group>
      <Text fw={600}>{strings.locations.empty}</Text>
      <Text size="sm" c="dimmed" ta="center" maw="24rem">
        {strings.locations.emptyHint}
      </Text>
      <HintButton
        tooltip={strings.tooltips.addBuilding}
        size="sm"
        leftSection={<Plus size="1rem" aria-hidden />}
        onClick={onAdd}
      >
        {strings.locations.addRoot}
      </HintButton>
    </Stack>
  )
}

/** Buildings get "Add floor", floors get "Add room" (room is a leaf). */
function addChildTooltip(parentKind: LocationKind): string {
  return parentKind === 'building' ? strings.locations.addFloor : strings.locations.addRoom
}

/** Buildings contain floors, floors contain rooms. */
function childKind(parentKind: LocationKind | null): LocationKind {
  if (parentKind === null) return LOCATION_KINDS[0]
  const at = LOCATION_KINDS.indexOf(parentKind)
  return LOCATION_KINDS[Math.min(at + 1, LOCATION_KINDS.length - 1)] ?? 'room'
}
