import { LOCATION_KINDS, type Location } from '@rivian-kanban/core'
import {
  ActionIcon,
  Box,
  Button,
  Group,
  Modal,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core'
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { useCreateLocation, useDeleteLocation, useRenameLocation } from '../api/admin.ts'
import { useLocations } from '../api/meta.ts'
import { isConflictError } from '../api/problem.ts'
import { buildLocationTree, type LocationTreeNode } from '../lib/location-tree.ts'
import { LocationKindIcon } from '../settings/location-kind-icon.tsx'
import classes from '../settings/locations.module.css'
import { strings } from '../strings.ts'

/**
 * First-boot Step 2: a friendly, non-technical location editor shown right
 * after the admin account is created (the session is already live, so the
 * admin-gated `/locations` calls work). It shares the Settings tree's visual
 * language — kind icons, indentation, comfortable rows — but stays simple:
 * inline "Add building/floor/room" affordances and a confirm-before-remove,
 * because the whole step is optional (Skip vs. Continue both land on the
 * board). The full-featured editor lives in Settings.
 */
export function SetupLocations({ onDone }: { onDone: () => void }) {
  const locations = useLocations()
  const tree = buildLocationTree(locations.data ?? [])
  const [removing, setRemoving] = useState<{ location: Location; hasChildren: boolean } | null>(
    null,
  )

  return (
    <Stack gap="md">
      <Stack gap="xs">
        <Group gap="xs" align="baseline">
          <Title order={1} size="h3">
            {strings.setup.locationsTitle}
          </Title>
          <Text size="sm" c="dimmed">
            {strings.setup.locationsOptional}
          </Text>
        </Group>
        <Text size="sm" c="dimmed">
          {strings.setup.locationsIntro}
        </Text>
      </Stack>

      {tree.length === 0 ? (
        <Text size="sm" c="dimmed">
          {strings.setup.locationsEmpty}
        </Text>
      ) : (
        <Box role="tree" aria-label={strings.locations.treeLabel}>
          {tree.map((node) => (
            <BuildingNode
              key={node.value}
              node={node}
              onRemove={(location, hasChildren) => {
                setRemoving({ location, hasChildren })
              }}
            />
          ))}
        </Box>
      )}

      <AddChild
        parent={null}
        label={strings.setup.addBuilding}
        placeholder={strings.setup.addBuildingPlaceholder}
      />

      <Group justify="space-between" mt="md">
        <Button variant="subtle" color="gray" onClick={onDone}>
          {strings.setup.skipButton}
        </Button>
        <Button onClick={onDone}>{strings.setup.continueButton}</Button>
      </Group>

      {removing !== null ? (
        <Modal
          opened
          onClose={() => {
            setRemoving(null)
          }}
          title={strings.setup.removeTitle}
          centered
        >
          <Stack gap="md">
            <Text size="sm" fw={600}>
              {strings.setup.removeConfirmBody(removing.location.name)}
            </Text>
            {removing.hasChildren ? (
              <Text size="sm" c="dimmed">
                {strings.setup.removeWarnsDescendants(removing.location.name)}
              </Text>
            ) : null}
            <Group justify="flex-end">
              <Button
                variant="default"
                onClick={() => {
                  setRemoving(null)
                }}
              >
                {strings.common.cancel}
              </Button>
              <RemoveConfirmButton
                location={removing.location}
                onDone={() => {
                  setRemoving(null)
                }}
              />
            </Group>
          </Stack>
        </Modal>
      ) : null}
    </Stack>
  )
}

/** A building with its floors, each floor with its rooms — reads like the site. */
function BuildingNode({
  node,
  onRemove,
}: {
  node: LocationTreeNode
  onRemove: (location: Location, hasChildren: boolean) => void
}) {
  return (
    <Box role="treeitem" aria-label={node.location.name}>
      <LocationRow
        location={node.location}
        hasChildren={node.children.length > 0}
        onRemove={onRemove}
      />
      <Box className={classes.children}>
        {node.children.map((floor) => (
          <Box key={floor.value} role="treeitem" aria-label={floor.location.name}>
            <LocationRow
              location={floor.location}
              hasChildren={floor.children.length > 0}
              onRemove={onRemove}
            />
            <Box className={classes.children}>
              {floor.children.map((room) => (
                <Box key={room.value} role="treeitem" aria-label={room.location.name}>
                  <LocationRow location={room.location} hasChildren={false} onRemove={onRemove} />
                </Box>
              ))}
              <AddChild
                parent={floor.location}
                label={strings.setup.addRoom}
                placeholder={strings.setup.addRoomPlaceholder}
              />
            </Box>
          </Box>
        ))}
        <AddChild
          parent={node.location}
          label={strings.setup.addFloor}
          placeholder={strings.setup.addFloorPlaceholder}
        />
      </Box>
    </Box>
  )
}

/**
 * A single location line with its icon, kind, and per-row actions (rename +
 * remove). Rename is an INLINE affordance: the label swaps in place for a
 * full-width TextInput with Save/Cancel, mirroring the Settings tree's rename
 * (same `useRenameLocation` mutation) but without leaving the wizard.
 */
function LocationRow({
  location,
  hasChildren,
  onRemove,
}: {
  location: Location
  hasChildren: boolean
  onRemove: (location: Location, hasChildren: boolean) => void
}) {
  const renameLocation = useRenameLocation()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(location.name)
  const nameError = isConflictError(renameLocation.error) ? strings.setup.duplicateName : null

  const startEditing = () => {
    setDraft(location.name)
    renameLocation.reset()
    setEditing(true)
  }
  const cancelEditing = () => {
    renameLocation.reset()
    setEditing(false)
  }
  const submit = () => {
    const trimmed = draft.trim()
    if (trimmed === '') return
    // No-op rename (unchanged name) just closes the editor — never a request.
    if (trimmed === location.name) {
      setEditing(false)
      return
    }
    renameLocation.mutate(
      { locationId: location.id, name: trimmed },
      {
        onSuccess: () => {
          setEditing(false)
        },
      },
    )
  }

  if (editing) {
    return (
      <Group className={classes.row} gap="xs" wrap="nowrap">
        <LocationKindIcon kind={location.kind} />
        <TextInput
          aria-label={strings.setup.renameNameLabel(location.name)}
          data-autofocus
          w="100%"
          value={draft}
          error={nameError}
          onChange={(event) => {
            setDraft(event.currentTarget.value)
            if (renameLocation.error !== null) renameLocation.reset()
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              submit()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              cancelEditing()
            }
          }}
        />
        <Group gap="xs" wrap="nowrap">
          <Tooltip label={strings.setup.saveRename}>
            <ActionIcon
              variant="subtle"
              color="green"
              aria-label={strings.setup.saveRename}
              loading={renameLocation.isPending}
              disabled={draft.trim() === ''}
              onClick={submit}
            >
              <Check size="1.1rem" aria-hidden />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={strings.setup.cancelRename}>
            <ActionIcon
              variant="subtle"
              color="gray"
              aria-label={strings.setup.cancelRename}
              onClick={cancelEditing}
            >
              <X size="1.1rem" aria-hidden />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
    )
  }

  return (
    <Group className={classes.row} gap="sm" wrap="nowrap">
      <LocationKindIcon kind={location.kind} />
      <Text size="sm" fw={500}>
        {location.name}
      </Text>
      <Group className={classes.actions} gap="xs" wrap="nowrap">
        <Tooltip label={strings.setup.renameLocationLabel(location.name)}>
          <ActionIcon
            variant="subtle"
            color="gray"
            aria-label={strings.setup.renameLocationLabel(location.name)}
            onClick={startEditing}
          >
            <Pencil size="1.1rem" aria-hidden />
          </ActionIcon>
        </Tooltip>
        <Tooltip label={strings.setup.removeLocationLabel(location.name)}>
          <ActionIcon
            variant="subtle"
            color="red"
            aria-label={strings.setup.removeLocationLabel(location.name)}
            onClick={() => {
              onRemove(location, hasChildren)
            }}
          >
            <Trash2 size="1.1rem" aria-hidden />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Group>
  )
}

/** The confirm button that actually issues the delete (recursive on the server). */
function RemoveConfirmButton({ location, onDone }: { location: Location; onDone: () => void }) {
  const deleteLocation = useDeleteLocation()
  return (
    <Button
      color="red"
      loading={deleteLocation.isPending}
      onClick={() => {
        deleteLocation.mutate(location.id, { onSuccess: onDone })
      }}
    >
      {strings.setup.confirmRemove}
    </Button>
  )
}

/**
 * Inline "add a child here" affordance. `parent` null adds a building; a
 * building parent adds a floor; a floor parent adds a room (kind derived from
 * the parent, mirroring the Settings editor).
 */
function AddChild({
  parent,
  label,
  placeholder,
}: {
  parent: Location | null
  label: string
  placeholder: string
}) {
  const createLocation = useCreateLocation()
  const [name, setName] = useState('')
  const nameError = isConflictError(createLocation.error) ? strings.setup.duplicateName : null

  const submit = () => {
    const trimmed = name.trim()
    if (trimmed === '') return
    createLocation.mutate(
      { parentId: parent?.id ?? null, kind: childKind(parent), name: trimmed },
      {
        onSuccess: () => {
          setName('')
        },
      },
    )
  }

  return (
    // The name field grows to fill the row (ITEM C): a wide, obvious target
    // instead of a cramped box, with the add button pinned to its right.
    <Group gap="xs" align="flex-start" py="xs" wrap="nowrap">
      <TextInput
        aria-label={label}
        placeholder={placeholder}
        flex={1}
        value={name}
        error={nameError}
        onChange={(event) => {
          setName(event.currentTarget.value)
          if (createLocation.error !== null) createLocation.reset()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            submit()
          }
        }}
      />
      <Button
        variant="light"
        size="sm"
        leftSection={<Plus size="1rem" aria-hidden />}
        loading={createLocation.isPending}
        disabled={name.trim() === ''}
        onClick={submit}
      >
        {label}
      </Button>
    </Group>
  )
}

/** null → building, building → floor, floor → room (the site hierarchy). */
function childKind(parent: Location | null) {
  if (parent === null) return LOCATION_KINDS[0]
  const at = LOCATION_KINDS.indexOf(parent.kind)
  return LOCATION_KINDS[Math.min(at + 1, LOCATION_KINDS.length - 1)] ?? 'room'
}
