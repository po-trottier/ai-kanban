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

/** Priority, blocked, waiting (with overdue styling), and terminal badges. */
export function CardBadges({ card, today }: { card: BoardCard; today: string }) {
  const overdue = isOverdueResume(card.expectedResumeAt, today)
  return (
    <Group gap="xs">
      <Badge color={PRIORITY_COLORS[card.priority]} size="sm" variant="filled">
        {strings.priorities[card.priority]}
      </Badge>
      {card.blocked ? (
        <Badge color={BLOCKED_COLOR} size="sm" variant="outline">
          {strings.card.blockedBadge}
        </Badge>
      ) : null}
      {card.waitingReason !== null ? (
        <Badge
          color={overdue ? OVERDUE_COLOR : WAITING_COLOR}
          size="sm"
          variant={overdue ? 'filled' : 'light'}
        >
          {overdue
            ? strings.card.overdueBadge(strings.waiting.reasons[card.waitingReason])
            : strings.card.waitingBadge(strings.waiting.reasons[card.waitingReason])}
        </Badge>
      ) : null}
      {card.resolution !== null && card.resolution !== 'completed' ? (
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
