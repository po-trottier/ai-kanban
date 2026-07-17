import { type BoardCard, type LaneKey } from '@rivian-kanban/core'
import { Avatar, Badge, Group, Paper, Text, Tooltip } from '@mantine/core'
import { DropIndicator } from '@atlaskit/pragmatic-drag-and-drop-react-drop-indicator/box'
import { useRef } from 'react'
import { type PickerUser } from '../api/schemas.ts'
import { formatDate, formatEstimate, initials } from '../lib/format.ts'
import { PinIcon } from '../shell/icons.tsx'
import { strings } from '../strings.ts'
import { EMPHASIS_FONT_WEIGHT } from '../theme.ts'
import { CardBadges } from './CardBadges.tsx'
import { CardMenu, type CardMenuAction } from './CardMenu.tsx'
import { cx } from '../lib/cx.ts'
import classes from './board.module.css'
import { useCardDnd } from './dnd.ts'

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
 * One board card. Every card renders the SAME rows so they compare at a
 * glance (consistency over minimalism): badges, an estimate, tag chips, a
 * location line, an attachment indicator, and the assignee — each with a
 * clear placeholder when unset.
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
        onOpen(card.id)
      }}
    >
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xs">
        <Text size="sm" fw={EMPHASIS_FONT_WEIGHT}>
          {card.title}
        </Text>
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
      <Group justify="space-between" mt="xs" gap="xs">
        <CardBadges card={card} today={today} />
        {resumeAt === null ? null : (
          <Text size="xs" c="dimmed">
            {strings.card.resumePrefix(formatDate(resumeAt))}
          </Text>
        )}
      </Group>
      {card.tags.length === 0 ? null : (
        <Group gap="xs" mt="xs">
          {card.tags.map((tag) => (
            <Badge key={tag} size="sm" variant="outline" color="gray">
              {tag}
            </Badge>
          ))}
        </Group>
      )}
      {/* The location line always renders (placeholder when unset) so a card
          with no location reads consistently against ones that have it. */}
      <Group gap="xs" mt="xs" wrap="nowrap">
        <PinIcon size={14} />
        {card.locationLabel === null ? (
          <Text size="xs" c="dimmed">
            {strings.card.noLocation}
          </Text>
        ) : (
          <Text size="xs">{card.locationLabel}</Text>
        )}
      </Group>
      <Group justify="space-between" mt="xs" gap="xs" wrap="nowrap">
        <Group gap="sm" wrap="nowrap">
          {card.estimateMinutes === null ? (
            <Text size="xs" c="dimmed">
              {strings.card.noEstimate}
            </Text>
          ) : (
            <Text size="xs">{formatEstimate(card.estimateMinutes)}</Text>
          )}
          {/* Always shown (like estimate/location) so every card reads the same
              and a zero is clearly "no files", not a missing feature. */}
          <Tooltip label={strings.card.attachmentCountLabel(card.attachmentCount)}>
            <Group
              gap="xs"
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
