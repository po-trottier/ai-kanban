import { type BoardCard, type LaneKey, type PolicyDocument, type Role } from '@rivian-kanban/core'
import { Center, Stack, Text, Title } from '@mantine/core'
import { useCallback, useMemo, useRef } from 'react'
import { type BoardResponse, type PickerUser } from '../api/schemas.ts'
import { NewCardButton } from '../shell/NewCardButton.tsx'
import { cx } from '../lib/cx.ts'
import { strings } from '../strings.ts'
import { EMPHASIS_FONT_WEIGHT } from '../theme.ts'
import { type CardMenuAction } from './CardMenu.tsx'
import { LaneColumn } from './LaneColumn.tsx'
import classes from './board.module.css'
import { useBoardAutoScroll } from './dnd.ts'
import { canMoveToLane, canPerformAction } from './move-options.ts'

export interface BoardProps {
  board: BoardResponse
  /** Whether the filter bar is narrowing the board (server-filtered result). */
  filtering?: boolean
  /** A filtered fetch is in flight over the retained previous board (dim + busy). */
  loading?: boolean
  policy: PolicyDocument
  role: Role
  users: PickerUser[]
  today: string
  onOpenCard: (cardId: string) => void
  onMenuAction: (card: BoardCard, action: CardMenuAction) => void
}

/** The 7-lane board (presentational): affordances derive from the policy. */
export function Board({
  board,
  filtering = false,
  loading = false,
  policy,
  role,
  users,
  today,
  onOpenCard,
  onMenuAction,
}: BoardProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  useBoardAutoScroll(scrollRef)

  const usersById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users])
  // Explicit identity: this lands in dnd.ts effect deps — every new reference
  // tears down and re-registers all drop targets (possibly mid-drag), and the
  // React Compiler that would otherwise memoize it is off under Vitest.
  const canDropFrom = useCallback(
    (target: LaneKey) => (source: { cardId: number; laneKey: LaneKey }) =>
      canMoveToLane(policy, role, source.laneKey, target),
    [policy, role],
  )

  const noCards = board.lanes.every((snapshot) => snapshot.cards.length === 0)
  // A brand-new team sees a blank grid otherwise; nudge them to the New card
  // button rather than seven "No cards" columns with no call to action.
  const boardEmpty = !filtering && noCards
  // The filter matched nothing anywhere: rather than seven "No matching cards"
  // columns, surface one message pointing at how to widen the filter (scope All
  // reaches archived + closed cards — the filter is now the ONE search surface).
  const filterNoMatches = filtering && noCards

  return (
    <div
      ref={scrollRef}
      className={cx(classes.board, loading && classes.boardLoading)}
      aria-busy={loading}
      // A named landmark: aria-label on a role-less div is prohibited ARIA.
      role="region"
      aria-label={strings.board.boardLabel}
    >
      {boardEmpty ? (
        <Center className={classes.emptyBoard}>
          <Stack align="center" gap="sm">
            <Title order={2} size="h4" fw={EMPHASIS_FONT_WEIGHT}>
              {strings.board.emptyBoardTitle}
            </Title>
            <Text size="sm" c="dimmed">
              {strings.board.emptyBoardHint}
            </Text>
            <NewCardButton />
          </Stack>
        </Center>
      ) : filterNoMatches ? (
        <Center className={classes.emptyBoard}>
          <Stack align="center" gap="sm">
            <Title order={2} size="h4" fw={EMPHASIS_FONT_WEIGHT}>
              {strings.filterBar.noMatchesTitle}
            </Title>
            <Text size="sm" c="dimmed" ta="center" maw="26rem">
              {strings.filterBar.noMatchesHint}
            </Text>
          </Stack>
        </Center>
      ) : (
        board.lanes.map((snapshot) => (
          <LaneColumn
            key={snapshot.lane.id}
            snapshot={snapshot}
            filtering={filtering}
            usersById={usersById}
            today={today}
            canCancel={canPerformAction(policy, role, 'cancel')}
            canReopen={canPerformAction(policy, role, 'reopen')}
            canArchive={canPerformAction(policy, role, 'archive')}
            canDropFrom={canDropFrom}
            onOpenCard={onOpenCard}
            onMenuAction={onMenuAction}
          />
        ))
      )}
    </div>
  )
}
