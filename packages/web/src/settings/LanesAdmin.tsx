import { Button, NumberInput, Table, TextInput } from '@mantine/core'
import { Check } from 'lucide-react'
import { useState } from 'react'
import { usePatchLane } from '../api/admin.ts'
import { useBoard } from '../api/board.ts'
import { type LaneSnapshot } from '../api/schemas.ts'
import { strings } from '../strings.ts'
import { SIZES } from '../theme.ts'

/**
 * Lane labels and WIP limits (`PATCH /lanes/:id`) as an aligned grid —
 * fixed input widths keep columns consistent regardless of label length,
 * matching the Users table's visual language.
 */
export function LanesAdmin() {
  const board = useBoard()
  return (
    <Table>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>{strings.lanes.labelHeader}</Table.Th>
          <Table.Th>{strings.lanes.wipLimitLabel}</Table.Th>
          <Table.Th />
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {(board.data?.lanes ?? []).map((snapshot) => (
          <LaneRow key={snapshot.lane.id} snapshot={snapshot} />
        ))}
      </Table.Tbody>
    </Table>
  )
}

function LaneRow({ snapshot }: { snapshot: LaneSnapshot }) {
  const patchLane = usePatchLane()
  const [label, setLabel] = useState(snapshot.lane.label)
  const [wipLimit, setWipLimit] = useState<number | null>(snapshot.lane.wipLimit)
  const dirty = label !== snapshot.lane.label || wipLimit !== snapshot.lane.wipLimit

  return (
    <Table.Tr aria-label={strings.lanes.rowLabel(snapshot.lane.label)}>
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
        <Button
          size="sm"
          leftSection={<Check size={16} aria-hidden />}
          disabled={!dirty || label.trim() === ''}
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
        </Button>
      </Table.Td>
    </Table.Tr>
  )
}
