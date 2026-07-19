import {
  type Card,
  type LaneKey,
  type PolicyDocument,
  type Role,
  type WaitingReason,
} from '@rivian-kanban/core'
import { Loader, Select } from '@mantine/core'
import { useState } from 'react'
import { useMoveCard } from '../api/board.ts'
import { isWaitingLane } from '../api/board-cache.ts'
import { type BoardResponse } from '../api/schemas.ts'
import { cardStatusColor } from '../board/card-status.ts'
import { canMoveToLane, positionChoices } from '../board/move-options.ts'
import { WaitingLaneModal } from '../board/WaitingLaneModal.tsx'
import { utcToday } from '../lib/format.ts'
import { strings } from '../strings.ts'

export interface CardStateSelectProps {
  card: Card
  /** The unfiltered board (lanes + their cards) — needed for the target neighbors. */
  board: BoardResponse | undefined
  policy: PolicyDocument | undefined
  role: Role
  /** Archived cards are read-only (reopen first). */
  disabled?: boolean
}

/**
 * The card's lane as a dropdown in the detail panel — change a card's state
 * without dragging it on the board. Reuses the board's move machinery so the UI
 * and server can't drift: only policy-allowed transitions are offered
 * (`canMoveToLane` — the same engine the server re-validates with), the card
 * lands at the BOTTOM of the target lane (the unambiguous "Last" end, like the
 * Move menu), and entering Waiting on Parts / Vendor detours through the same
 * reason + resume-date modal the board uses. The move is If-Match guarded and
 * refetches the card, so the select reflects the new state once it settles.
 */
export function CardStateSelect({
  card,
  board,
  policy,
  role,
  disabled = false,
}: CardStateSelectProps) {
  const move = useMoveCard()
  // A pending move into the waiting lane, held while its reason + date are collected.
  const [waitingTarget, setWaitingTarget] = useState<LaneKey | null>(null)

  const currentLane = board?.lanes.find((snapshot) => snapshot.lane.id === card.laneId)
  const currentKey = currentLane?.lane.key ?? null

  // Every lane is listed; a transition the policy forbids is shown disabled
  // (the current lane is always the enabled, selected value).
  const data = (board?.lanes ?? []).map((snapshot) => {
    const key = snapshot.lane.key
    const allowed =
      key === currentKey ||
      (policy !== undefined && currentKey !== null && canMoveToLane(policy, role, currentKey, key))
    return { value: key, label: snapshot.lane.label, disabled: !allowed }
  })

  /** Move the card to the BOTTOM of `toLane`, carrying any waiting-lane fields. */
  const moveTo = (
    toLane: LaneKey,
    waiting?: { waitingReason: WaitingReason; expectedResumeAt: string },
    comment?: string,
  ) => {
    const target = board?.lanes.find((snapshot) => snapshot.lane.key === toLane)
    if (target === undefined) return
    const [, last] = positionChoices(target.cards, card.id, {
      first: strings.move.positionFirst,
      last: strings.move.positionLast,
    })
    move.mutate({
      card,
      intent: {
        toLane,
        prevCardId: last.prevCardId,
        nextCardId: last.nextCardId,
        ...(waiting ?? {}),
      },
      laneLabel: target.lane.label,
      ...(comment === undefined ? {} : { comment }),
    })
  }

  const onChange = (value: string | null) => {
    if (value === null || value === currentKey) return
    const toLane = value as LaneKey
    // Entering the waiting lane (from a non-waiting lane) needs a reason + date.
    if (isWaitingLane(toLane) && !(currentKey !== null && isWaitingLane(currentKey))) {
      setWaitingTarget(toLane)
      return
    }
    moveTo(toLane)
  }

  // Tint the control with the SAME status hue the board card shows (blocked,
  // waiting/overdue, cancelled, archived) so the panel echoes the card; a plain
  // on-track card gets the default border. `-filled` is the theme's per-color
  // token — a token reference, never a literal (ADR-016 rule 1).
  const statusColor = cardStatusColor(card, utcToday())
  // Only include `styles` when there IS a status hue (exactOptionalPropertyTypes
  // forbids passing `styles={undefined}`).
  const statusStyles =
    statusColor === undefined
      ? {}
      : { styles: { input: { borderColor: `var(--mantine-color-${statusColor}-filled)` } } }

  return (
    <>
      <Select
        label={strings.detail.stateLabel}
        data={data}
        value={currentKey}
        allowDeselect={false}
        disabled={disabled || board === undefined}
        {...statusStyles}
        rightSection={
          move.isPending ? <Loader size="xs" aria-label={strings.common.loading} /> : undefined
        }
        onChange={onChange}
      />
      {waitingTarget !== null ? (
        <WaitingLaneModal
          onClose={() => {
            setWaitingTarget(null)
          }}
          onSubmit={({ waitingReason, expectedResumeAt, comment }) => {
            moveTo(waitingTarget, { waitingReason, expectedResumeAt }, comment)
            setWaitingTarget(null)
          }}
        />
      ) : null}
    </>
  )
}
