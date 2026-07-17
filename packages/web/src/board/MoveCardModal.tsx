import { type Card, type LaneKey, type PolicyDocument, type Role } from '@rivian-kanban/core'
import { Button, Group, Modal, Select, Stack } from '@mantine/core'
import { useState } from 'react'
import { type MoveIntent } from '../api/board-cache.ts'
import { type BoardResponse } from '../api/schemas.ts'
import { strings } from '../strings.ts'
import { canMoveToLane, isSamePosition, positionChoices } from './move-options.ts'

export interface MoveSelection {
  intent: MoveIntent
  laneLabel: string
  /** 1-based position in the target lane, for the live-region announcement. */
  position: number
}

export interface MoveCardModalProps {
  card: Card
  currentLane: LaneKey
  board: BoardResponse
  policy: PolicyDocument
  role: Role
  onSubmit: (selection: MoveSelection) => void
  onClose: () => void
}

/**
 * The keyboard/touch "Move to…" flow (ADR-007): pick a column and a position;
 * emits exactly the neighbor-id command the drag path uses. Illegal targets
 * (enforcement on) stay visible but disabled.
 */
export function MoveCardModal({
  card,
  currentLane,
  board,
  policy,
  role,
  onSubmit,
  onClose,
}: MoveCardModalProps) {
  const [laneKey, setLaneKey] = useState<LaneKey>(currentLane)
  const [positionValue, setPositionValue] = useState('first')

  const laneOptions = board.lanes.map((snapshot) => ({
    value: snapshot.lane.key,
    label: snapshot.lane.label,
    disabled: !canMoveToLane(policy, role, currentLane, snapshot.lane.key),
  }))

  const targetLane = board.lanes.find((snapshot) => snapshot.lane.key === laneKey)
  const choices = positionChoices(targetLane?.cards ?? [], card.id, {
    first: strings.move.positionFirst,
    after: strings.move.positionAfter,
  })
  const selected = choices.find((choice) => choice.value === positionValue) ?? choices[0]
  // The preselected current lane can itself be disallowed (e.g. reorderReady).
  const laneAllowed = canMoveToLane(policy, role, currentLane, laneKey)

  return (
    <Modal opened onClose={onClose} title={strings.move.modalTitle}>
      <Stack gap="md">
        <Select
          label={strings.move.laneLabel}
          data={laneOptions}
          value={laneKey}
          allowDeselect={false}
          error={laneAllowed ? undefined : strings.move.laneNotAllowed}
          onChange={(value) => {
            if (value !== null) {
              setLaneKey(value)
              setPositionValue('first')
            }
          }}
        />
        <Select
          label={strings.move.positionLabel}
          data={choices.map(({ value, label }) => ({ value, label }))}
          value={selected.value}
          allowDeselect={false}
          onChange={(value) => {
            if (value !== null) setPositionValue(value)
          }}
        />
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onClose}>
            {strings.common.cancel}
          </Button>
          <Button
            disabled={!laneAllowed}
            onClick={() => {
              const intent: MoveIntent = {
                toLane: laneKey,
                prevCardId: selected.prevCardId,
                nextCardId: selected.nextCardId,
              }
              // Submitting the current position would write a spurious reorder.
              if (isSamePosition(board, card.id, intent)) {
                onClose()
                return
              }
              onSubmit({
                intent,
                laneLabel: targetLane?.lane.label ?? laneKey,
                position: choices.indexOf(selected) + 1,
              })
            }}
          >
            {strings.move.moveButton}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
