import { isOverdueResume, type BoardCard, type Card } from '@rivian-kanban/core'
import { type MantineColor } from '@mantine/core'
import { workProgress } from '../lib/work-progress.ts'
import {
  ARCHIVED_COLOR,
  BLOCKED_COLOR,
  CANCELLED_COLOR,
  OVERDUE_COLOR,
  WAITING_COLOR,
} from '../theme.ts'

/** Lanes between Ready and Done where a card carries a live work burn-down. */
export const WORKING_LANES: ReadonlySet<string> = new Set([
  'in_progress',
  'waiting_parts_vendor',
  'review',
])

/**
 * Whether a card's WORK burn-down has passed its estimate — the in-progress
 * "overdue" state (distinct from the waiting-resume overdue). True only in a
 * working lane with a started clock + an estimate; needs a live `now`, so the
 * caller supplies it. Shared by the board card chip and the detail-panel banner.
 */
export function isWorkOverdue(
  card: Pick<BoardCard & Card, 'workStartedAt' | 'estimateMinutes'>,
  laneKey: string | null,
  now: Date,
  timezone: string,
): boolean {
  if (laneKey === null || !WORKING_LANES.has(laneKey)) return false
  if (card.workStartedAt === null || card.estimateMinutes === null) return false
  return workProgress(card.workStartedAt, card.estimateMinutes, now, timezone).overdue
}

/** The fields that decide whether a card shows any status badge. */
type StatusFields = Pick<
  BoardCard & Card,
  'blocked' | 'waitingReason' | 'resolution' | 'archivedAt'
>

/** Whether a card carries any STATUS badge (blocked / waiting / cancelled /
 * archived) — lets a caller decide whether to render a status row at all. */
export function hasCardStatus(card: StatusFields): boolean {
  const cancelled = card.resolution !== null && card.resolution !== 'completed'
  return card.blocked || card.waitingReason !== null || cancelled || card.archivedAt !== null
}

/** Everything `cardStatusColor` reads (status + the overdue resume date). */
type StatusColorFields = StatusFields & Pick<BoardCard & Card, 'expectedResumeAt'>

/**
 * The status hue for a card — the SAME theme colors the board card badges use
 * (blocked=grape, waiting=yellow, overdue=pink, cancelled=dark, archived=gray),
 * so the detail panel's State dropdown reads the same color as its board card.
 * Returns `undefined` for a plain (unblocked, on-track) card — no accent to
 * apply. The precedence mirrors CardBadges: blocked, then waiting/overdue, then
 * the terminal cancelled/archived states.
 */
export function cardStatusColor(card: StatusColorFields, today: string): MantineColor | undefined {
  if (card.blocked) return BLOCKED_COLOR
  if (card.waitingReason !== null)
    return isOverdueResume(card.expectedResumeAt, today) ? OVERDUE_COLOR : WAITING_COLOR
  if (card.resolution !== null && card.resolution !== 'completed') return CANCELLED_COLOR
  if (card.archivedAt !== null) return ARCHIVED_COLOR
  return undefined
}
