import { LOCATION_KINDS, type Location, type LocationKind } from '@rivian-kanban/core'
import { Button, Group, Modal, Stack, Text, TextInput, Tree } from '@mantine/core'
import { useState } from 'react'
import { useCreateLocation, useDeleteLocation, useRenameLocation } from '../api/admin.ts'
import { useLocations } from '../api/meta.ts'
import { buildLocationTree } from '../lib/location-tree.ts'
import { ConfirmModal } from '../shell/ConfirmModal.tsx'
import { strings } from '../strings.ts'

type LocationModal =
  | { kind: 'none' }
  | { kind: 'add'; parent: Location | null }
  | { kind: 'rename'; location: Location }
  | { kind: 'delete'; location: Location }

/** Location tree CRUD: buildings → floors → rooms. */
export function LocationsAdmin() {
  const locations = useLocations()
  const createLocation = useCreateLocation()
  const renameLocation = useRenameLocation()
  const deleteLocation = useDeleteLocation()
  const [modal, setModal] = useState<LocationModal>({ kind: 'none' })
  const [name, setName] = useState('')

  const all = locations.data ?? []
  const tree = buildLocationTree(all)
  const byId = new Map(all.map((location) => [location.id, location]))

  const openAdd = (parent: Location | null) => {
    setName('')
    setModal({ kind: 'add', parent })
  }
  const openRename = (location: Location) => {
    setName(location.name)
    setModal({ kind: 'rename', location })
  }
  const openDelete = (location: Location) => {
    setModal({ kind: 'delete', location })
  }
  const close = () => {
    setModal({ kind: 'none' })
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
      <Group justify="flex-end">
        <Button
          size="sm"
          onClick={() => {
            openAdd(null)
          }}
        >
          {strings.locations.addRoot}
        </Button>
      </Group>
      {tree.length === 0 ? (
        <Text size="sm" c="dimmed">
          {strings.locations.empty}
        </Text>
      ) : (
        <Tree
          data={tree}
          aria-label={strings.locations.treeLabel}
          renderNode={({ node, elementProps, expanded, hasChildren }) => {
            const location = byId.get(node.value)
            return (
              <Group gap="xs" py="xs" {...elementProps}>
                {hasChildren ? <Text size="xs">{expanded ? '▾' : '▸'}</Text> : null}
                <Text size="sm">{node.label}</Text>
                {location !== undefined ? (
                  <NodeActions
                    location={location}
                    onAdd={openAdd}
                    onRename={openRename}
                    onDelete={openDelete}
                  />
                ) : null}
              </Group>
            )
          }}
        />
      )}

      {modal.kind === 'add' || modal.kind === 'rename' ? (
        <Modal
          opened
          onClose={close}
          title={modal.kind === 'add' ? strings.locations.addTitle : strings.locations.renameTitle}
        >
          <Stack gap="md">
            <TextInput
              label={strings.locations.nameLabel}
              value={name}
              onChange={(event) => {
                setName(event.currentTarget.value)
              }}
            />
            <Group justify="flex-end">
              <Button
                loading={createLocation.isPending || renameLocation.isPending}
                disabled={name.trim() === ''}
                onClick={submit}
              >
                {strings.common.save}
              </Button>
            </Group>
          </Stack>
        </Modal>
      ) : null}

      {modal.kind === 'delete' ? (
        <ConfirmModal
          title={strings.locations.deleteConfirmTitle}
          body={strings.locations.deleteConfirmBody(modal.location.name)}
          confirmLabel={strings.locations.deleteConfirm}
          loading={deleteLocation.isPending}
          onConfirm={() => {
            deleteLocation.mutate(modal.location.id, { onSuccess: close })
          }}
          onClose={close}
        />
      ) : null}
    </Stack>
  )
}

function NodeActions({
  location,
  onAdd,
  onRename,
  onDelete,
}: {
  location: Location
  onAdd: (parent: Location) => void
  onRename: (location: Location) => void
  onDelete: (location: Location) => void
}) {
  // Labeled buttons, not cryptic glyphs: a non-technical admin should read
  // "Add / Rename / Delete", not guess at + ✎ ✕. Delete stays red.
  return (
    <Group gap="xs">
      {location.kind !== 'room' ? (
        <Button
          size="compact-xs"
          variant="subtle"
          aria-label={strings.locations.addChildLabel(location.name)}
          onClick={(event) => {
            event.stopPropagation()
            onAdd(location)
          }}
        >
          {strings.locations.add}
        </Button>
      ) : null}
      <Button
        size="compact-xs"
        variant="subtle"
        aria-label={strings.locations.renameLabel(location.name)}
        onClick={(event) => {
          event.stopPropagation()
          onRename(location)
        }}
      >
        {strings.locations.rename}
      </Button>
      <Button
        size="compact-xs"
        variant="subtle"
        color="red"
        aria-label={strings.locations.deleteLabel(location.name)}
        onClick={(event) => {
          event.stopPropagation()
          onDelete(location)
        }}
      >
        {strings.common.delete}
      </Button>
    </Group>
  )
}

/** Buildings contain floors, floors contain rooms. */
function childKind(parentKind: LocationKind | null): LocationKind {
  if (parentKind === null) return LOCATION_KINDS[0]
  const at = LOCATION_KINDS.indexOf(parentKind)
  return LOCATION_KINDS[Math.min(at + 1, LOCATION_KINDS.length - 1)] ?? 'room'
}
