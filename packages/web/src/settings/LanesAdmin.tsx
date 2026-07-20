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
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine'
import {
  draggable,
  dropTargetForElements,
  monitorForElements,
} from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import {
  attachClosestEdge,
  extractClosestEdge,
} from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge'
import { type Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/types'
import { DropIndicator } from '@atlaskit/pragmatic-drag-and-drop-react-drop-indicator/box'
import { GripVertical, Plus, Save, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { useCreateLane, useDeleteLane, usePatchLane, useReorderLanes } from '../api/admin.ts'
import { useBoard } from '../api/board.ts'
import { type LaneSnapshot } from '../api/schemas.ts'
import { cx } from '../lib/cx.ts'
import { reorderedLaneIds } from './lane-reorder.ts'
import { ConfirmModal } from '../shell/ConfirmModal.tsx'
import { FieldLabel } from '../shell/FieldLabel.tsx'
import { HintButton } from '../shell/HintButton.tsx'
import { SkeletonRows } from '../shell/SkeletonRows.tsx'
import { strings } from '../strings.ts'
import { SIZES } from '../theme.ts'
import classes from './lanes.module.css'

// The one thin adapter over Pragmatic drag-and-drop (ADR-007), mirroring
// board/dnd.ts: rows are draggable by a grip handle and drop targets reporting
// the closest top/bottom edge; a table-level monitor turns a drop into the new
// ordered id list. Native HTML5 drag events don't exist in happy-dom, so the
// real drag path is Playwright's job (docs/dev/testing.md).
const LANE_ROW_TYPE = 'rivian-kanban/lane-row'

interface LaneDragData extends Record<string | symbol, unknown> {
  type: typeof LANE_ROW_TYPE
  laneId: string
}

function isLaneDragData(data: Record<string | symbol, unknown>): data is LaneDragData {
  return data.type === LANE_ROW_TYPE
}

/**
 * Configurable board columns (docs/architecture/rest-api.md#admin): rename +
 * WIP (`PATCH /lanes/:id`), reorder by dragging the row's grip handle
 * (`POST /lanes/reorder`), add (`POST /lanes`), and delete (`DELETE /lanes/:id`).
 * Any column is deletable once empty — including the seeded ones — except the
 * last remaining one (a board must keep ≥1 column; the server returns 409, and
 * we mirror that guard client-side). Fixed input widths keep the grid aligned
 * regardless of label length.
 */
export function LanesAdmin() {
  const board = useBoard()
  const reorderLanes = useReorderLanes()
  const snapshots = board.data?.lanes ?? []
  const orderedIds = snapshots.map((snapshot) => snapshot.lane.id)
  const orderKey = orderedIds.join(',')

  // One monitor watches every lane-row drop and posts the reordered id list.
  useEffect(
    () =>
      monitorForElements({
        canMonitor: ({ source }) => isLaneDragData(source.data),
        onDrop: ({ source, location }) => {
          if (!isLaneDragData(source.data)) return
          const target = location.current.dropTargets[0]
          if (target === undefined || !isLaneDragData(target.data)) return
          const list = orderKey.split(',')
          const next = reorderedLaneIds(
            list,
            source.data.laneId,
            target.data.laneId,
            extractClosestEdge(target.data),
          )
          // Same reference back means an in-place drop — skip the round-trip.
          if (next !== list) reorderLanes.mutate(next)
        },
      }),
    // orderKey is the current order flattened; it re-registers the monitor only
    // when the order actually changes, not on every unrelated board refetch.
    [orderKey, reorderLanes],
  )

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Text c="dimmed" size="sm">
          {strings.lanes.intro}
        </Text>
        <AddLaneButton />
      </Group>
      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{strings.lanes.orderHeader}</Table.Th>
            <Table.Th>{strings.lanes.labelHeader}</Table.Th>
            <Table.Th>
              <FieldLabel label={strings.lanes.wipLimitLabel} help={strings.fieldHelp.wipLimit} />
            </Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {board.isPending ? <SkeletonRows rows={7} cols={4} /> : null}
          {snapshots.map((snapshot) => (
            <LaneRow key={snapshot.lane.id} snapshot={snapshot} laneCount={snapshots.length} />
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  )
}

interface LaneRowDndState {
  dragging: boolean
  closestEdge: Edge | null
}

const idleRowState: LaneRowDndState = { dragging: false, closestEdge: null }

/** Makes a lane row draggable by its handle and a drop target reporting the edge. */
function useLaneRowDnd(
  rowRef: RefObject<HTMLElement | null>,
  handleRef: RefObject<HTMLElement | null>,
  laneId: string,
): LaneRowDndState {
  const [state, setState] = useState<LaneRowDndState>(idleRowState)

  useEffect(() => {
    const row = rowRef.current
    const handle = handleRef.current
    if (row === null || handle === null) return
    const data: LaneDragData = { type: LANE_ROW_TYPE, laneId }
    return combine(
      draggable({
        element: row,
        dragHandle: handle,
        getInitialData: () => data,
        onDragStart: () => {
          setState((current) => ({ ...current, dragging: true }))
        },
        onDrop: () => {
          setState(idleRowState)
        },
      }),
      dropTargetForElements({
        element: row,
        canDrop: ({ source }) => isLaneDragData(source.data),
        getData: ({ input, element }) =>
          attachClosestEdge(data, { input, element, allowedEdges: ['top', 'bottom'] }),
        getIsSticky: () => true,
        onDrag: ({ self }) => {
          setState((current) => ({ ...current, closestEdge: extractClosestEdge(self.data) }))
        },
        onDragLeave: () => {
          setState((current) => ({ ...current, closestEdge: null }))
        },
        onDrop: () => {
          setState(idleRowState)
        },
      }),
    )
  }, [rowRef, handleRef, laneId])

  return state
}

function LaneRow({ snapshot, laneCount }: { snapshot: LaneSnapshot; laneCount: number }) {
  const patchLane = usePatchLane()
  const deleteLane = useDeleteLane()
  const rowRef = useRef<HTMLTableRowElement | null>(null)
  const handleRef = useRef<HTMLButtonElement | null>(null)
  const { dragging, closestEdge } = useLaneRowDnd(rowRef, handleRef, snapshot.lane.id)
  const [label, setLabel] = useState(snapshot.lane.label)
  const [wipLimit, setWipLimit] = useState<number | null>(snapshot.lane.wipLimit)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const dirty = label !== snapshot.lane.label || wipLimit !== snapshot.lane.wipLimit
  // A board must keep ≥1 column; the last one can't be deleted (server 409).
  const isLastLane = laneCount <= 1

  return (
    <Table.Tr
      ref={rowRef}
      className={cx(classes.row, dragging && classes.rowDragging)}
      aria-label={strings.lanes.rowLabel(snapshot.lane.label)}
    >
      <Table.Td className={classes.handle}>
        <Tooltip label={strings.tooltips.dragLane}>
          <ActionIcon
            ref={handleRef}
            variant="subtle"
            color="gray"
            aria-label={strings.lanes.dragHandleLabel(snapshot.lane.label)}
          >
            <GripVertical size={16} aria-hidden />
          </ActionIcon>
        </Tooltip>
      </Table.Td>
      <Table.Td>
        <TextInput
          aria-label={`${strings.lanes.labelLabel} (${snapshot.lane.label})`}
          w={SIZES.laneLabelInputWidth}
          value={label}
          onChange={(event) => {
            setLabel(event.currentTarget.value)
          }}
        />
      </Table.Td>
      <Table.Td>
        <NumberInput
          aria-label={`${strings.lanes.wipLimitLabel} (${snapshot.lane.label})`}
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
        {/* Save + delete sit together at min width, not one column each. */}
        <Group gap="xs" wrap="nowrap" justify="flex-end">
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
          <Tooltip
            label={isLastLane ? strings.tooltips.deleteLastLane : strings.tooltips.deleteLane}
          >
            {/* Span keeps the tooltip anchored even when the icon is disabled
                (a native-disabled button swallows hover events). */}
            <span>
              <ActionIcon
                variant="subtle"
                color="red"
                aria-label={`${strings.tooltips.deleteLane} (${snapshot.lane.label})`}
                disabled={isLastLane || deleteLane.isPending}
                loading={deleteLane.isPending}
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
            title={strings.lanes.deleteConfirmTitle}
            body={strings.lanes.deleteConfirmBody(snapshot.lane.label)}
            confirmLabel={strings.lanes.deleteConfirmLabel}
            loading={deleteLane.isPending}
            onConfirm={() => {
              deleteLane.mutate(snapshot.lane.id, {
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
        {/* Absolutely positioned against the row (`.row` is relative), so the
            drop line spans the row width even though it lives in one cell —
            a bare div is invalid as a direct `<tr>` child. */}
        {closestEdge !== null ? (
          <DropIndicator edge={closestEdge} gap="var(--mantine-spacing-xs)" />
        ) : null}
      </Table.Td>
    </Table.Tr>
  )
}

/**
 * Adds a column with a default label the admin renames inline (keys are
 * generated from the label server-side), so there is no name field to fill —
 * one click at the top-right of the section.
 */
function AddLaneButton() {
  const createLane = useCreateLane()
  return (
    <HintButton
      tooltip={strings.tooltips.addColumn}
      leftSection={<Plus size={16} aria-hidden />}
      loading={createLane.isPending}
      onClick={() => {
        createLane.mutate({ label: strings.lanes.newColumnDefault, wipLimit: null })
      }}
    >
      {strings.lanes.addButton}
    </HintButton>
  )
}
