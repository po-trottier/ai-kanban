import { isOverdueResume, type BoardCard } from '@rivian-kanban/core'
import { Badge, Group } from '@mantine/core'
import { strings } from '../strings.ts'
import {
  BLOCKED_COLOR,
  CANCELLED_COLOR,
  OVERDUE_COLOR,
  PRIORITY_COLORS,
  WAITING_COLOR,
} from '../theme.ts'

/**
 * Priority, blocked, waiting (with overdue styling), and terminal badges.
 * Status chips share one `light` variant (screenshot-audit consistency);
 * only the priority chip is filled. The card panel hoists priority into its
 * header (`showPriority={false}`) — with no status to show, nothing renders.
 */
export function CardBadges({
  card,
  today,
  showPriority = true,
}: {
  card: BoardCard
  today: string
  showPriority?: boolean
}) {
  const overdue = isOverdueResume(card.expectedResumeAt, today)
  const cancelled = card.resolution !== null && card.resolution !== 'completed'
  const hasStatus =
    card.blocked || card.waitingReason !== null || cancelled || card.archivedAt !== null
  if (!showPriority && !hasStatus) return null
  return (
    <Group gap="xs">
      {showPriority ? (
        <Badge color={PRIORITY_COLORS[card.priority]} size="sm" variant="filled">
          {strings.priorities[card.priority]}
        </Badge>
      ) : null}
      {card.blocked ? (
        <Badge color={BLOCKED_COLOR} size="sm" variant="light">
          {strings.card.blockedBadge}
        </Badge>
      ) : null}
      {card.waitingReason !== null ? (
        <Badge color={overdue ? OVERDUE_COLOR : WAITING_COLOR} size="sm" variant="light">
          {overdue
            ? strings.card.overdueBadge(strings.waiting.reasons[card.waitingReason])
            : strings.card.waitingBadge(strings.waiting.reasons[card.waitingReason])}
        </Badge>
      ) : null}
      {cancelled && card.resolution !== null ? (
        <Badge color={CANCELLED_COLOR} size="sm" variant="light">
          {strings.resolutions[card.resolution]}
        </Badge>
      ) : null}
      {card.archivedAt !== null ? (
        <Badge color={CANCELLED_COLOR} size="sm" variant="outline">
          {strings.card.archivedBadge}
        </Badge>
      ) : null}
    </Group>
  )
}
