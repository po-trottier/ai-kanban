import { isOverdueResume, type BoardCard, type Card } from '@rivian-kanban/core'
import { Badge, Group, Tooltip } from '@mantine/core'
import { hasCardStatus } from './card-status.ts'
import { formatDate } from '../lib/format.ts'
import { strings } from '../strings.ts'
import {
  ARCHIVED_COLOR,
  BLOCKED_COLOR,
  CANCELLED_COLOR,
  OVERDUE_COLOR,
  PRIORITY_COLORS,
  WAITING_COLOR,
} from '../theme.ts'

/**
 * The status fields the badge row reads — the intersection of `BoardCard`
 * (board) and the full `Card` (search results, panel), so both satisfy it
 * without a widening cast.
 */
export type CardBadgeFields = Pick<
  BoardCard & Card,
  | 'priority'
  | 'blocked'
  | 'blockedReason'
  | 'waitingReason'
  | 'expectedResumeAt'
  | 'resolution'
  | 'archivedAt'
>

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
  card: CardBadgeFields
  today: string
  showPriority?: boolean
}) {
  const overdue = isOverdueResume(card.expectedResumeAt, today)
  const cancelled = card.resolution !== null && card.resolution !== 'completed'
  if (!showPriority && !hasCardStatus(card)) return null
  return (
    <Group gap="xs">
      {showPriority ? (
        // Priority meaning on hover — the same plain-language copy the card-detail
        // priority picker shows (single source in strings.priorityOptions).
        <Tooltip
          label={strings.card.priorityBadgeTooltip(
            strings.priorityOptions[card.priority].name,
            strings.priorityOptions[card.priority].description,
          )}
        >
          <Badge color={PRIORITY_COLORS[card.priority]} size="sm" variant="filled">
            {strings.priorities[card.priority]}
          </Badge>
        </Tooltip>
      ) : null}
      {card.blocked ? (
        // The reason is the most useful context; surface it on hover so a
        // technician scanning the board never has to open the card for it.
        <Tooltip
          label={card.blockedReason ?? strings.detail.blockedBannerNoReason}
          disabled={card.blockedReason === null}
          multiline
        >
          <Badge color={BLOCKED_COLOR} size="sm" variant="light">
            {strings.card.blockedBadge}
          </Badge>
        </Tooltip>
      ) : null}
      {card.waitingReason !== null ? (
        // A color-only chip: on hover, spell out the reason + resume date so the
        // waiting/overdue state reads without opening the card or the legend.
        <Tooltip
          label={
            overdue
              ? strings.card.overdueBadgeTooltip(
                  strings.waiting.reasons[card.waitingReason],
                  card.expectedResumeAt === null ? '' : formatDate(card.expectedResumeAt),
                )
              : strings.card.waitingBadgeTooltip(
                  strings.waiting.reasons[card.waitingReason],
                  card.expectedResumeAt === null ? '' : formatDate(card.expectedResumeAt),
                )
          }
          multiline
        >
          <Badge color={overdue ? OVERDUE_COLOR : WAITING_COLOR} size="sm" variant="light">
            {overdue
              ? strings.card.overdueBadge(strings.waiting.reasons[card.waitingReason])
              : strings.card.waitingBadge(strings.waiting.reasons[card.waitingReason])}
          </Badge>
        </Tooltip>
      ) : null}
      {cancelled && card.resolution !== null ? (
        <Tooltip label={strings.card.cancelledBadgeTooltip(strings.resolutions[card.resolution])}>
          <Badge color={CANCELLED_COLOR} size="sm" variant="light">
            {strings.resolutions[card.resolution]}
          </Badge>
        </Tooltip>
      ) : null}
      {card.archivedAt !== null ? (
        <Tooltip label={strings.card.archivedBadgeTooltip}>
          <Badge color={ARCHIVED_COLOR} size="sm" variant="outline">
            {strings.card.archivedBadge}
          </Badge>
        </Tooltip>
      ) : null}
    </Group>
  )
}
