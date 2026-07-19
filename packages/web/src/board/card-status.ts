import { isOverdueResume, type BoardCard, type Card } from '@rivian-kanban/core'
import { type MantineColor } from '@mantine/core'
import {
  ARCHIVED_COLOR,
  BLOCKED_COLOR,
  CANCELLED_COLOR,
  OVERDUE_COLOR,
  WAITING_COLOR,
} from '../theme.ts'

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
