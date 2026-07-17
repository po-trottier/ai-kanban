import { type Card, type LaneKey } from '@rivian-kanban/core'
import { Avatar, Group, Paper, Pill, Text, Tooltip } from '@mantine/core'
import { DropIndicator } from '@atlaskit/pragmatic-drag-and-drop-react-drop-indicator/box'
import { useRef } from 'react'
import { type BoardCard, type PickerUser } from '../api/schemas.ts'
import { formatEstimate, initials } from '../lib/format.ts'
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
  canDropFrom: (source: { cardId: string; laneKey: LaneKey }) => boolean
  onOpen: (cardId: string) => void
  onMenuAction: (card: Card, action: CardMenuAction) => void
}

/** One board card: badges, estimate, tags, assignee avatar, the ⋯ menu. */
export function CardItem({
  card,
  laneKey,
  assignee,
  today,
  canCancel,
  canReopen,
  canDropFrom,
  onOpen,
  onMenuAction,
}: CardItemProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const { dragging, closestEdge } = useCardDnd(ref, card, laneKey, canDropFrom)

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
          onAction={(action) => {
            onMenuAction(card, action)
          }}
        />
      </Group>
      <Group justify="space-between" mt="xs" gap="xs">
        <CardBadges card={card} today={today} />
      </Group>
      {card.tags.length > 0 ? (
        <Group gap="xs" mt="xs">
          {card.tags.map((tag) => (
            <Pill key={tag} size="xs">
              {tag}
            </Pill>
          ))}
        </Group>
      ) : null}
      <Group justify="space-between" mt="xs" gap="xs">
        <Text size="xs" c="dimmed">
          {card.estimateMinutes === null ? '' : formatEstimate(card.estimateMinutes)}
        </Text>
        {assignee === undefined ? (
          <Tooltip label={strings.card.unassigned}>
            <Avatar size="sm" radius="xl" aria-label={strings.card.unassigned} />
          </Tooltip>
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
