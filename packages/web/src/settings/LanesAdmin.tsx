import {
  ActionIcon,
  Group,
  NumberInput,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core'
import { isSystemLaneKey } from '@rivian-kanban/core'
import { ChevronDown, ChevronUp, Plus, Save, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useCreateLane, useDeleteLane, usePatchLane, useReorderLanes } from '../api/admin.ts'
import { useBoard } from '../api/board.ts'
import { type LaneSnapshot } from '../api/schemas.ts'
import { FieldLabel } from '../shell/FieldLabel.tsx'
import { HintButton } from '../shell/HintButton.tsx'
import { SkeletonRows } from '../shell/SkeletonRows.tsx'
import { strings } from '../strings.ts'
import { SIZES } from '../theme.ts'

/**
 * Configurable board columns (docs/architecture/rest-api.md#admin): rename +
 * WIP (`PATCH /lanes/:id`), reorder (`POST /lanes/reorder`), add
 * (`POST /lanes`), and delete (`DELETE /lanes/:id`). The 7 seeded columns carry
 * the workflow behavior, so they are renamable/reorderable but can't be deleted;
 * admin-added columns are removable once empty. Fixed input widths keep the
 * grid aligned regardless of label length.
 */
export function LanesAdmin() {
  const board = useBoard()
  const reorderLanes = useReorderLanes()
  const snapshots = board.data?.lanes ?? []
  const orderedIds = snapshots.map((snapshot) => snapshot.lane.id)

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction
    const current = orderedIds[index]
    const swap = orderedIds[target]
    if (current === undefined || swap === undefined) return
    const next = [...orderedIds]
    next[index] = swap
    next[target] = current
    reorderLanes.mutate(next)
  }

  return (
    <Stack gap="md">
      <Text c="dimmed" size="sm">
        {strings.lanes.intro}
      </Text>
      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{strings.lanes.orderHeader}</Table.Th>
            <Table.Th>{strings.lanes.labelHeader}</Table.Th>
            <Table.Th>
              <FieldLabel label={strings.lanes.wipLimitLabel} help={strings.fieldHelp.wipLimit} />
            </Table.Th>
            <Table.Th />
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {board.isPending ? <SkeletonRows rows={7} cols={5} /> : null}
          {snapshots.map((snapshot, index) => (
            <LaneRow
              key={snapshot.lane.id}
              snapshot={snapshot}
              index={index}
              count={snapshots.length}
              reordering={reorderLanes.isPending}
              onMove={move}
            />
          ))}
        </Table.Tbody>
      </Table>
      <AddLaneForm />
    </Stack>
  )
}

interface LaneRowProps {
  snapshot: LaneSnapshot
  index: number
  count: number
  reordering: boolean
  onMove: (index: number, direction: -1 | 1) => void
}

function LaneRow({ snapshot, index, count, reordering, onMove }: LaneRowProps) {
  const patchLane = usePatchLane()
  const deleteLane = useDeleteLane()
  const [label, setLabel] = useState(snapshot.lane.label)
  const [wipLimit, setWipLimit] = useState<number | null>(snapshot.lane.wipLimit)
  const dirty = label !== snapshot.lane.label || wipLimit !== snapshot.lane.wipLimit
  const isSystem = isSystemLaneKey(snapshot.lane.key)

  return (
    <Table.Tr aria-label={strings.lanes.rowLabel(snapshot.lane.label)}>
      <Table.Td>
        <Group gap={4} wrap="nowrap">
          <Tooltip label={strings.tooltips.moveLaneUp}>
            <ActionIcon
              variant="subtle"
              color="gray"
              aria-label={`${strings.tooltips.moveLaneUp} (${snapshot.lane.label})`}
              disabled={index === 0 || reordering}
              onClick={() => {
                onMove(index, -1)
              }}
            >
              <ChevronUp size={16} aria-hidden />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={strings.tooltips.moveLaneDown}>
            <ActionIcon
              variant="subtle"
              color="gray"
              aria-label={`${strings.tooltips.moveLaneDown} (${snapshot.lane.label})`}
              disabled={index === count - 1 || reordering}
              onClick={() => {
                onMove(index, 1)
              }}
            >
              <ChevronDown size={16} aria-hidden />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Table.Td>
      <Table.Td>
        <TextInput
          aria-label={`${strings.lanes.labelLabel} (${snapshot.lane.key})`}
          w={SIZES.laneLabelInputWidth}
          // The machine key is dev context, not a user-facing column: keep it
          // as a dimmed secondary line under the editable label, not a header.
          description={snapshot.lane.key}
          value={label}
          onChange={(event) => {
            setLabel(event.currentTarget.value)
          }}
        />
      </Table.Td>
      <Table.Td>
        <NumberInput
          aria-label={`${strings.lanes.wipLimitLabel} (${snapshot.lane.key})`}
          w={SIZES.laneWipLimitInputWidth}
          placeholder={strings.lanes.wipLimitNone}
          min={1}
          value={wipLimit ?? ''}
          onChange={(value) => {
            setWipLimit(typeof value === 'number' ? value : null)
          }}
        />
      </Table.Td>
      <Table.Td>
        <HintButton
          size="sm"
          tooltip={strings.tooltips.saveLane}
          disabledReason={
            label.trim() === ''
              ? strings.tooltips.disabledEmptyName
              : dirty
                ? undefined
                : strings.tooltips.disabledNoChanges
          }
          leftSection={<Save size={16} aria-hidden />}
          loading={patchLane.isPending}
          onClick={() => {
            patchLane.mutate({
              laneId: snapshot.lane.id,
              input: { label: label.trim(), wipLimit },
              label: label.trim(),
            })
          }}
        >
          {strings.common.save}
        </HintButton>
      </Table.Td>
      <Table.Td>
        <Tooltip label={isSystem ? strings.tooltips.deleteSystemLane : strings.tooltips.deleteLane}>
          {/* Span keeps the tooltip anchored even when the icon is disabled
              (a native-disabled button swallows hover events). */}
          <span>
            <ActionIcon
              variant="subtle"
              color="red"
              aria-label={`${strings.tooltips.deleteLane} (${snapshot.lane.label})`}
              disabled={isSystem || deleteLane.isPending}
              loading={deleteLane.isPending}
              onClick={() => {
                deleteLane.mutate(snapshot.lane.id)
              }}
            >
              <Trash2 size={16} aria-hidden />
            </ActionIcon>
          </span>
        </Tooltip>
      </Table.Td>
    </Table.Tr>
  )
}

function AddLaneForm() {
  const createLane = useCreateLane()
  const [label, setLabel] = useState('')
  const submit = () => {
    const trimmed = label.trim()
    if (trimmed === '') return
    createLane.mutate(
      { label: trimmed, wipLimit: null },
      {
        onSuccess: () => {
          setLabel('')
        },
      },
    )
  }

  return (
    <Group gap="sm" align="flex-end">
      <TextInput
        label={strings.lanes.addTitle}
        placeholder={strings.lanes.addPlaceholder}
        w={SIZES.laneLabelInputWidth}
        value={label}
        onChange={(event) => {
          setLabel(event.currentTarget.value)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') submit()
        }}
      />
      <HintButton
        tooltip={strings.tooltips.addColumn}
        disabledReason={label.trim() === '' ? strings.tooltips.disabledEmptyName : undefined}
        leftSection={<Plus size={16} aria-hidden />}
        loading={createLane.isPending}
        onClick={submit}
      >
        {strings.lanes.addButton}
      </HintButton>
    </Group>
  )
}
