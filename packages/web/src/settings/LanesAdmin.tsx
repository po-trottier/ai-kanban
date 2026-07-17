import { Button, Group, NumberInput, Stack, TextInput } from '@mantine/core'
import { useState } from 'react'
import { usePatchLane } from '../api/admin.ts'
import { useBoard } from '../api/board.ts'
import { type LaneSnapshot } from '../api/schemas.ts'
import { strings } from '../strings.ts'

/** Lane labels and WIP limits (`PATCH /lanes/:id`). */
export function LanesAdmin() {
  const board = useBoard()
  return (
    <Stack gap="md">
      {(board.data?.lanes ?? []).map((snapshot) => (
        <LaneRow key={snapshot.lane.id} snapshot={snapshot} />
      ))}
    </Stack>
  )
}

function LaneRow({ snapshot }: { snapshot: LaneSnapshot }) {
  const patchLane = usePatchLane()
  const [label, setLabel] = useState(snapshot.lane.label)
  const [wipLimit, setWipLimit] = useState<number | null>(snapshot.lane.wipLimit)
  const dirty = label !== snapshot.lane.label || wipLimit !== snapshot.lane.wipLimit

  return (
    <Group align="flex-end" gap="sm" aria-label={strings.lanes.rowLabel(snapshot.lane.label)}>
      <TextInput
        label={`${strings.lanes.labelLabel} (${snapshot.lane.key})`}
        value={label}
        onChange={(event) => {
          setLabel(event.currentTarget.value)
        }}
      />
      <NumberInput
        label={`${strings.lanes.wipLimitLabel} (${snapshot.lane.key})`}
        placeholder={strings.lanes.wipLimitNone}
        min={1}
        value={wipLimit ?? ''}
        onChange={(value) => {
          setWipLimit(typeof value === 'number' ? value : null)
        }}
      />
      <Button
        size="sm"
        disabled={!dirty || label.trim() === ''}
        loading={patchLane.isPending}
        onClick={() => {
          patchLane.mutate({
            laneId: snapshot.lane.id,
            input: { label: label.trim(), wipLimit },
          })
        }}
      >
        {strings.common.save}
      </Button>
    </Group>
  )
}
