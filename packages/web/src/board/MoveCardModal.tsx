import {
  WAITING_REASONS,
  type BoardCard,
  type LaneKey,
  type PolicyDocument,
  type Role,
  type WaitingReason,
} from '@rivian-kanban/core'
import { Button, Group, Modal, Select, Stack, Text, Textarea } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { ArrowRightLeft } from 'lucide-react'
import { useState } from 'react'
import { isWaitingLane, type MoveIntent } from '../api/board-cache.ts'
import { type BoardResponse } from '../api/schemas.ts'
import { useUserTimezone } from '../auth/session-context.ts'
import { todayInTimezone } from '../lib/format.ts'
import { strings } from '../strings.ts'
import { canMoveToLane, dropPosition, isSamePosition, positionChoices } from './move-options.ts'

export interface MoveSelection {
  intent: MoveIntent
  laneLabel: string
  /** 1-based position in the target lane, for the live-region announcement. */
  position: number
  /** Optional note when entering the waiting lane, posted as a card comment. */
  comment?: string
}

/** Narrows the Select's `string | null` to a WaitingReason (or null). */
function asWaitingReason(value: string | null): WaitingReason | null {
  return WAITING_REASONS.find((reason) => reason === value) ?? null
}

export interface MoveCardModalProps {
  // Only the id is read (neighbor math); a board summary or full card fits.
  card: Pick<BoardCard, 'id'>
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
  const timezone = useUserTimezone()
  const [laneKey, setLaneKey] = useState<LaneKey>(currentLane)
  const [positionValue, setPositionValue] = useState('first')
  // Waiting-lane data collected inline (always-on data rule): the requirement
  // is visible at the point of choice, not after a confusing second modal.
  const [waitingReason, setWaitingReason] = useState<WaitingReason | null>(null)
  const [resumeAt, setResumeAt] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  // Once the user has engaged the waiting fields, surface a per-field required
  // message so the two mandatory fields are obvious, not just the greyed Move.
  const [waitingTouched, setWaitingTouched] = useState(false)

  const laneOptions = board.lanes.map((snapshot) => ({
    value: snapshot.lane.key,
    label: snapshot.lane.label,
    disabled: !canMoveToLane(policy, role, currentLane, snapshot.lane.key),
  }))

  const targetLane = board.lanes.find((snapshot) => snapshot.lane.key === laneKey)
  const choices = positionChoices(targetLane?.cards ?? [], card.id, {
    first: strings.move.positionFirst,
    last: strings.move.positionLast,
  })
  const selected = choices.find((choice) => choice.value === positionValue) ?? choices[0]
  // The preselected current lane can itself be disallowed (e.g. reorderReady).
  const laneAllowed = canMoveToLane(policy, role, currentLane, laneKey)
  // Entering the waiting lane (not a within-lane reorder) requires both fields.
  const entersWaiting = isWaitingLane(laneKey) && !isWaitingLane(currentLane)
  const waitingComplete = !entersWaiting || (waitingReason !== null && resumeAt !== null)

  return (
    <Modal opened onClose={onClose} title={strings.move.modalTitle} centered>
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
        {entersWaiting ? (
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              {strings.waiting.intro}
            </Text>
            <Select
              label={strings.waiting.reasonLabel}
              withAsterisk
              error={
                waitingTouched && waitingReason === null
                  ? strings.waiting.reasonRequired
                  : undefined
              }
              data={WAITING_REASONS.map((value) => ({
                value,
                label: strings.waiting.reasons[value],
              }))}
              value={waitingReason}
              onChange={(value) => {
                setWaitingTouched(true)
                setWaitingReason(asWaitingReason(value))
              }}
            />
            <DatePickerInput
              label={strings.waiting.resumeLabel}
              withAsterisk
              error={
                waitingTouched && resumeAt === null ? strings.waiting.resumeRequired : undefined
              }
              value={resumeAt}
              onChange={(value) => {
                setWaitingTouched(true)
                setResumeAt(value)
              }}
              minDate={todayInTimezone(timezone)}
              highlightToday
            />
            <Textarea
              label={strings.waiting.commentLabel}
              placeholder={strings.waiting.commentPlaceholder}
              value={comment}
              onChange={(event) => {
                setComment(event.currentTarget.value)
              }}
              autosize
              minRows={2}
              maxRows={5}
            />
          </Stack>
        ) : null}
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onClose}>
            {strings.common.cancel}
          </Button>
          <Button
            leftSection={<ArrowRightLeft size={16} aria-hidden />}
            disabled={!laneAllowed || !waitingComplete}
            onClick={() => {
              const intent: MoveIntent = {
                toLane: laneKey,
                prevCardId: selected.prevCardId,
                nextCardId: selected.nextCardId,
                ...(entersWaiting && waitingReason !== null && resumeAt !== null
                  ? { waitingReason, expectedResumeAt: resumeAt }
                  : {}),
              }
              // Submitting the current position would write a spurious reorder.
              if (isSamePosition(board, card.id, intent)) {
                onClose()
                return
              }
              const note = comment.trim()
              // "Last" can land far below its option index (position 2), so the
              // announcement uses the true 1-based landing spot, not the choice
              // ordinal — the same math the drag path announces with.
              const landing = dropPosition(board, card.id, intent)
              onSubmit({
                intent,
                laneLabel: targetLane?.lane.label ?? laneKey,
                position: landing?.position ?? choices.indexOf(selected) + 1,
                ...(entersWaiting && note !== '' ? { comment: note } : {}),
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
