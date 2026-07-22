import { type BoardCard, type LaneKey } from '@rivian-kanban/core'
import { Avatar, Badge, Group, Paper, Text, Tooltip } from '@mantine/core'
import { Paperclip } from 'lucide-react'
import { DropIndicator } from '@atlaskit/pragmatic-drag-and-drop-react-drop-indicator/box'
import { useRef } from 'react'
import { useBusinessHours } from '../api/meta.ts'
import { type PickerUser } from '../api/schemas.ts'
import { useUserTimezone } from '../auth/session-context.ts'
import { formatDate, formatEstimate, formatTicketNumber, initials } from '../lib/format.ts'
import { useNow } from '../lib/use-now.ts'
import { PinIcon } from '../shell/icons.tsx'
import { strings } from '../strings.ts'
import { EMPHASIS_FONT_WEIGHT, PRIORITY_COLORS } from '../theme.ts'
import { CardBadges } from './CardBadges.tsx'
import { hasCardStatus, isWorkOverdue, WORKING_LANES } from './card-status.ts'
import { CardMenu, type CardMenuAction } from './CardMenu.tsx'
import { WorkProgressBar } from './WorkProgressBar.tsx'
import { cx } from '../lib/cx.ts'
import classes from './board.module.css'
import { useCardDnd } from './dnd.ts'

/** Re-check work-overdue on the same minute cadence as the burn-down bar. */
const WORK_TICK_MS = 60_000

export interface CardItemProps {
  card: BoardCard
  laneKey: LaneKey
  assignee: PickerUser | undefined
  today: string
  canCancel: boolean
  canReopen: boolean
  canArchive: boolean
  canDropFrom: (source: { cardId: number; laneKey: LaneKey }) => boolean
  onOpen: (cardId: string) => void
  onMenuAction: (card: BoardCard, action: CardMenuAction) => void
}

/**
 * One board card in a compact, fixed shape so cards compare at a glance and
 * never change height with their content:
 *   Title …………………… Priority ⋯
 *   status badges (only when blocked/waiting/cancelled/archived)
 *   tag chips (one line, extras clipped)
 *   estimate · location · attachments ………………… assignee
 * Long text (title, location) ellipsizes to hold the shape. Cards past Ready
 * also carry the work burn-down bar at the bottom.
 */
export function CardItem({
  card,
  laneKey,
  assignee,
  today,
  canCancel,
  canReopen,
  canArchive,
  canDropFrom,
  onOpen,
  onMenuAction,
}: CardItemProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const { dragging, closestEdge } = useCardDnd(ref, card, laneKey, canDropFrom)
  const resumeAt = card.waitingReason !== null ? card.expectedResumeAt : null
  // Whether the work burn-down has passed its estimate — the same signal the
  // progress bar turns red on, surfaced as an "Overdue" badge so an in-progress
  // overdue card reads like a waiting-overdue one (both get the chip + tooltip).
  const timezone = useUserTimezone()
  const now = useNow(WORK_TICK_MS)
  const workOverdue = isWorkOverdue(card, laneKey, now, timezone, useBusinessHours())

  return (
    <Paper
      ref={ref}
      withBorder
      shadow="xs"
      p="sm"
      radius="md"
      className={cx(classes.card, dragging && classes.cardDragging)}
      // role="group" lets the aria-label name the card (prohibited on a bare div).
      role="group"
      aria-label={card.title}
      onClick={() => {
        onOpen(String(card.id))
      }}
    >
      {/* #number · title … priority + menu */}
      <Group justify="space-between" align="center" wrap="nowrap" gap="xs">
        <Group gap={6} wrap="nowrap" className={classes.grow}>
          <Text size="xs" c="dimmed" fw={EMPHASIS_FONT_WEIGHT}>
            {formatTicketNumber(card.id)}
          </Text>
          <Text size="sm" fw={EMPHASIS_FONT_WEIGHT} truncate className={classes.grow}>
            {card.title}
          </Text>
        </Group>
        <Group gap="xs" wrap="nowrap">
          {/* Priority meaning on hover — the same plain-language copy the
              card-detail priority picker shows (single source in strings). */}
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
          <CardMenu
            card={card}
            canCancel={canCancel}
            canReopen={canReopen}
            canArchive={canArchive}
            onAction={(action) => {
              onMenuAction(card, action)
            }}
          />
        </Group>
      </Group>
      {/* Status badges (blocked/waiting/overdue/cancelled/archived) — plus the
          work-overdue chip when the burn-down has passed its estimate. */}
      {hasCardStatus(card) || workOverdue ? (
        <Group justify="space-between" mt="xs" gap="xs" wrap="nowrap">
          <CardBadges card={card} today={today} showPriority={false} workOverdue={workOverdue} />
          {resumeAt === null ? null : (
            <Text size="xs" c="dimmed">
              {strings.card.resumePrefix(formatDate(resumeAt))}
            </Text>
          )}
        </Group>
      ) : null}
      {card.tags.length === 0 ? null : (
        // Pills render at natural width and the ROW clips its overflow (CSS),
        // so visible tags stay fully readable. The full set — including any
        // clipped off the right edge — is on the tooltip and aria-label.
        <Tooltip label={strings.card.tagsLabel(card.tags.join(', '))} multiline>
          <Group
            gap="xs"
            mt="xs"
            className={classes.tagRow}
            aria-label={strings.card.tagsLabel(card.tags.join(', '))}
          >
            {card.tags.map((tag) => (
              <Badge key={tag} size="sm" variant="outline" color="gray">
                {tag}
              </Badge>
            ))}
          </Group>
        </Tooltip>
      )}
      {/* estimate · location · attachments ………… assignee (one fixed row) */}
      <Group justify="space-between" mt="xs" gap="sm" wrap="nowrap">
        <Group gap="sm" wrap="nowrap" className={classes.grow}>
          {/* The compact "2h"/"1d" figure reads as an estimate on hover; the
              "No estimate" placeholder needs no explanation. */}
          {card.estimateMinutes === null ? (
            <Text size="xs" c="dimmed">
              {strings.card.noEstimate}
            </Text>
          ) : (
            <Tooltip label={strings.card.estimateTooltip(formatEstimate(card.estimateMinutes))}>
              <Text size="xs">{formatEstimate(card.estimateMinutes)}</Text>
            </Tooltip>
          )}
          {/* Location always renders (placeholder when unset); it ellipsizes so a
              long room name never grows the card — the full label is on hover. */}
          <Tooltip
            label={strings.card.locationLabel(card.locationLabel ?? '')}
            disabled={card.locationLabel === null}
          >
            <Group
              gap={4}
              wrap="nowrap"
              className={classes.grow}
              {...(card.locationLabel === null ? { c: 'dimmed' } : {})}
            >
              <PinIcon size={14} />
              <Text size="xs" truncate>
                {card.locationLabel ?? strings.card.noLocation}
              </Text>
            </Group>
          </Tooltip>
          {/* Always shown (a zero is clearly "no files", not a missing feature). */}
          <Tooltip label={strings.card.attachmentCountLabel(card.attachmentCount)}>
            <Group
              gap={4}
              wrap="nowrap"
              {...(card.attachmentCount === 0 ? { c: 'dimmed' } : {})}
              aria-label={strings.card.attachmentCountLabel(card.attachmentCount)}
            >
              <Paperclip size={14} aria-hidden />
              <Text size="xs" c="dimmed">
                {card.attachmentCount}
              </Text>
            </Group>
          </Tooltip>
        </Group>
        {assignee === undefined ? (
          <Text size="xs" c="dimmed">
            {strings.card.unassigned}
          </Text>
        ) : (
          <Tooltip label={assignee.displayName}>
            <Avatar
              size="sm"
              radius="xl"
              color="indigo"
              aria-label={strings.card.assigneeAvatarLabel(assignee.displayName)}
            >
              {initials(assignee.displayName)}
            </Avatar>
          </Tooltip>
        )}
      </Group>
      {WORKING_LANES.has(laneKey) &&
      card.workStartedAt !== null &&
      card.estimateMinutes !== null ? (
        <WorkProgressBar
          workStartedAt={card.workStartedAt}
          estimateMinutes={card.estimateMinutes}
          waiting={card.waitingReason !== null}
          blocked={card.blocked}
        />
      ) : null}
      {closestEdge !== null ? (
        <DropIndicator edge={closestEdge} gap="var(--mantine-spacing-xs)" />
      ) : null}
    </Paper>
  )
}
