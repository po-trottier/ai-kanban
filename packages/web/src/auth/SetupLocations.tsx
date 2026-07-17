import { LOCATION_KINDS, type Location } from '@rivian-kanban/core'
import { ActionIcon, Box, Button, Group, Stack, Text, TextInput, Title } from '@mantine/core'
import { useState } from 'react'
import { useCreateLocation, useDeleteLocation } from '../api/admin.ts'
import { useLocations } from '../api/meta.ts'
import { buildLocationTree, type LocationTreeNode } from '../lib/location-tree.ts'
import { strings } from '../strings.ts'

/**
 * First-boot Step 2: a minimal, non-technical location editor shown right
 * after the admin account is created (the session is already live, so the
 * admin-gated `/locations` calls work). It reuses the shared location API
 * hooks exactly like the Settings editor, but stays deliberately simple —
 * inline "Add building/floor/room" affordances, remove, and a clear empty
 * state — because the whole step is optional (Skip vs. Continue both land on
 * the board). The full-featured tree editor lives in Settings.
 */
export function SetupLocations({ onDone }: { onDone: () => void }) {
  const locations = useLocations()
  const tree = buildLocationTree(locations.data ?? [])

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
        <Stack gap="sm" aria-label={strings.locations.treeLabel}>
          {tree.map((node) => (
            <BuildingNode key={node.value} node={node} />
          ))}
        </Stack>
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
    </Stack>
  )
}

/** A building with its floors, each floor with its rooms — reads like the site. */
function BuildingNode({ node }: { node: LocationTreeNode }) {
  return (
    <Box>
      <LocationRow location={node.location} />
      <Stack gap="xs" pl="md" mt="xs">
        {node.children.map((floor) => (
          <Box key={floor.value}>
            <LocationRow location={floor.location} />
            <Stack gap="xs" pl="md" mt="xs">
              {floor.children.map((room) => (
                <LocationRow key={room.value} location={room.location} />
              ))}
              <AddChild
                parent={floor.location}
                label={strings.setup.addRoom}
                placeholder={strings.setup.addRoomPlaceholder}
              />
            </Stack>
          </Box>
        ))}
        <AddChild
          parent={node.location}
          label={strings.setup.addFloor}
          placeholder={strings.setup.addFloorPlaceholder}
        />
      </Stack>
    </Box>
  )
}

/** A single location line with its remove control. */
function LocationRow({ location }: { location: Location }) {
  const deleteLocation = useDeleteLocation()
  return (
    <Group gap="xs">
      <Text size="sm">{location.name}</Text>
      <ActionIcon
        size="sm"
        variant="subtle"
        color="red"
        aria-label={strings.setup.removeLocationLabel(location.name)}
        loading={deleteLocation.isPending}
        onClick={() => {
          deleteLocation.mutate(location.id)
        }}
      >
        ✕
      </ActionIcon>
    </Group>
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
    <Group gap="xs" align="flex-end">
      <TextInput
        aria-label={label}
        placeholder={placeholder}
        value={name}
        onChange={(event) => {
          setName(event.currentTarget.value)
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
