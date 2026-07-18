import { type BoardCard, type LaneKey } from '@rivian-kanban/core'
import { Avatar, Badge, Group, Paper, Text, Tooltip } from '@mantine/core'
import { DropIndicator } from '@atlaskit/pragmatic-drag-and-drop-react-drop-indicator/box'
import { useRef } from 'react'
import { type PickerUser } from '../api/schemas.ts'
import { formatDate, formatEstimate, formatTicketNumber, initials } from '../lib/format.ts'
import { PinIcon } from '../shell/icons.tsx'
import { strings } from '../strings.ts'
import { EMPHASIS_FONT_WEIGHT, PRIORITY_COLORS } from '../theme.ts'
import { CardBadges } from './CardBadges.tsx'
import { hasCardStatus } from './card-status.ts'
import { CardMenu, type CardMenuAction } from './CardMenu.tsx'
import { WorkProgressBar } from './WorkProgressBar.tsx'
import { cx } from '../lib/cx.ts'
import classes from './board.module.css'
import { useCardDnd } from './dnd.ts'

/** Lanes between Ready and Done where a card carries a live work burn-down bar. */
const WORKING_LANES = new Set<LaneKey>(['in_progress', 'waiting_parts_vendor', 'review'])

export interface CardItemProps {
  card: BoardCard
  laneKey: LaneKey
  assignee: PickerUser | undefined
  today: string
  canCancel: boolean
  canReopen: boolean
  canArchive: boolean
  canDropFrom: (source: { cardId: string; laneKey: LaneKey }) => boolean
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
        // Deep-link by the human ticket number (/cards/1), not the uuid.
        onOpen(String(card.number))
      }}
    >
      {/* #number · title … priority + menu */}
      <Group justify="space-between" align="center" wrap="nowrap" gap="xs">
        <Group gap={6} wrap="nowrap" className={classes.grow}>
          <Text size="xs" c="dimmed" fw={EMPHASIS_FONT_WEIGHT}>
            {formatTicketNumber(card.number)}
          </Text>
          <Text size="sm" fw={EMPHASIS_FONT_WEIGHT} truncate className={classes.grow}>
            {card.title}
          </Text>
        </Group>
        <Group gap="xs" wrap="nowrap">
          <Badge color={PRIORITY_COLORS[card.priority]} size="sm" variant="filled">
            {strings.priorities[card.priority]}
          </Badge>
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
      {/* Status badges (blocked/waiting/overdue/cancelled/archived) — only when set */}
      {hasCardStatus(card) ? (
        <Group justify="space-between" mt="xs" gap="xs" wrap="nowrap">
          <CardBadges card={card} today={today} showPriority={false} />
          {resumeAt === null ? null : (
            <Text size="xs" c="dimmed">
              {strings.card.resumePrefix(formatDate(resumeAt))}
            </Text>
          )}
        </Group>
      ) : null}
      {card.tags.length === 0 ? null : (
        <Group gap="xs" mt="xs" className={classes.tagRow}>
          {card.tags.map((tag) => (
            <Badge key={tag} size="sm" variant="outline" color="gray">
              {tag}
            </Badge>
          ))}
        </Group>
      )}
      {/* estimate · location · attachments ………… assignee (one fixed row) */}
      <Group justify="space-between" mt="xs" gap="sm" wrap="nowrap">
        <Group gap="sm" wrap="nowrap" className={classes.grow}>
          <Text size="xs" {...(card.estimateMinutes === null ? { c: 'dimmed' } : {})}>
            {card.estimateMinutes === null
              ? strings.card.noEstimate
              : formatEstimate(card.estimateMinutes)}
          </Text>
          {/* Location always renders (placeholder when unset); it ellipsizes so a
              long room name never grows the card. */}
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
          {/* Always shown (a zero is clearly "no files", not a missing feature). */}
          <Tooltip label={strings.card.attachmentCountLabel(card.attachmentCount)}>
            <Group
              gap={4}
              wrap="nowrap"
              {...(card.attachmentCount === 0 ? { c: 'dimmed' } : {})}
              aria-label={strings.card.attachmentCountLabel(card.attachmentCount)}
            >
              <Paperclip />
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
        />
      ) : null}
      {closestEdge !== null ? (
        <DropIndicator edge={closestEdge} gap="var(--mantine-spacing-xs)" />
      ) : null}
    </Paper>
  )
}

/** A paperclip glyph for the attachment indicator (currentColor SVG). */
function Paperclip() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      <path d="M21 8.5 11.5 18a4 4 0 0 1-5.66-5.66l8.49-8.49a2.5 2.5 0 1 1 3.54 3.54L9.6 15.6a1 1 0 0 1-1.42-1.42l7.78-7.78" />
    </svg>
  )
}
