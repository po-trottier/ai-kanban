import { type BoardCard, type LaneKey } from '@rivian-kanban/core'
import { Badge, Group, Text, Title, Tooltip } from '@mantine/core'
import { useMemo, useRef } from 'react'
import { type LaneSnapshot, type PickerUser } from '../api/schemas.ts'
import { cx } from '../lib/cx.ts'
import { strings } from '../strings.ts'
import { EMPHASIS_FONT_WEIGHT } from '../theme.ts'
import { CardItem } from './CardItem.tsx'
import { type CardMenuAction } from './CardMenu.tsx'
import classes from './board.module.css'
import { useLaneDnd } from './dnd.ts'

export interface LaneColumnProps {
  snapshot: LaneSnapshot
  /** When the header filter is active, show a match count + a filtered hint. */
  filtering?: boolean
  usersById: Map<string, PickerUser>
  today: string
  canCancel: boolean
  canReopen: boolean
  canDropFrom: (target: LaneKey) => (source: { cardId: string; laneKey: LaneKey }) => boolean
  onOpenCard: (cardId: string) => void
  onMenuAction: (card: BoardCard, action: CardMenuAction) => void
}

/** One lane: header (label + WIP state) and the card list in position order. */
export function LaneColumn({
  snapshot,
  filtering = false,
  usersById,
  today,
  canCancel,
  canReopen,
  canDropFrom,
  onOpenCard,
  onMenuAction,
}: LaneColumnProps) {
  const { lane, cards, wipLimitExceeded } = snapshot
  const listRef = useRef<HTMLDivElement | null>(null)
  // Stable identity: this is an effect dependency in useLaneDnd/useCardDnd.
  const laneCanDrop = useMemo(() => canDropFrom(lane.key), [canDropFrom, lane.key])
  const { isDropTarget } = useLaneDnd(listRef, lane.key, laneCanDrop)

  const wipLabel =
    lane.wipLimit === null
      ? String(cards.length)
      : `${String(cards.length)}/${String(lane.wipLimit)}`
  const wipTooltip =
    lane.wipLimit === null
      ? strings.board.wipNoLimitTooltip(cards.length)
      : strings.board.wipTooltip(cards.length, lane.wipLimit)

  return (
    <section className={classes.lane} aria-label={lane.label}>
      <Group className={classes.laneHeader} justify="space-between" gap="xs" wrap="nowrap">
        <Title order={3} size="sm">
          {lane.label}
        </Title>
        <Group gap="xs" wrap="nowrap">
          {filtering ? (
            // While filtering, a subtle match count stands in for the WIP badge:
            // the badge counts the FILTERED subset, so "2/5" would mislead.
            <Text size="xs" c="dimmed">
              {strings.board.filterMatchCount(cards.length)}
            </Text>
          ) : (
            <>
              {/* The count is opaque ("2/5") without words; explain it on hover
                  and surface a visible "Over limit" cue when exceeded. */}
              {wipLimitExceeded ? (
                <Text size="xs" c="red" fw={EMPHASIS_FONT_WEIGHT}>
                  {strings.board.overLimit}
                </Text>
              ) : null}
              <Tooltip label={wipTooltip} multiline>
                <Badge
                  color={wipLimitExceeded ? 'red' : 'gray'}
                  variant={wipLimitExceeded ? 'filled' : 'light'}
                  size="sm"
                  aria-label={
                    wipLimitExceeded
                      ? `${wipLabel} — ${strings.board.wipLimitExceededSuffix}`
                      : wipLabel
                  }
                >
                  {wipLabel}
                </Badge>
              </Tooltip>
            </>
          )}
        </Group>
      </Group>
      <div
        ref={listRef}
        className={cx(classes.laneCards, isDropTarget && classes.laneCardsOver)}
        role="list"
        aria-label={strings.board.cardListLabel(lane.label)}
      >
        {cards.length === 0 ? (
          <Text size="xs" c="dimmed" ta="center" mt="sm">
            {filtering ? strings.board.filterEmptyLane : strings.board.emptyLane}
          </Text>
        ) : (
          cards.map((card) => (
            <div role="listitem" key={card.id}>
              <CardItem
                card={card}
                laneKey={lane.key}
                assignee={card.assigneeId === null ? undefined : usersById.get(card.assigneeId)}
                today={today}
                canCancel={canCancel}
                canReopen={canReopen}
                canDropFrom={laneCanDrop}
                onOpen={onOpenCard}
                onMenuAction={onMenuAction}
              />
            </div>
          ))
        )}
      </div>
    </section>
  )
}
