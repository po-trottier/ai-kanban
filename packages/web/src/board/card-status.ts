import { type BoardCard, type Card } from '@rivian-kanban/core'

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
