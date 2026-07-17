import { type BoardCard, type LaneKey, type PolicyDocument, type Role } from '@rivian-kanban/core'
import { useCallback, useMemo, useRef } from 'react'
import { type BoardResponse, type PickerUser } from '../api/schemas.ts'
import { strings } from '../strings.ts'
import { type CardMenuAction } from './CardMenu.tsx'
import { LaneColumn } from './LaneColumn.tsx'
import classes from './board.module.css'
import { useBoardAutoScroll } from './dnd.ts'
import { canMoveToLane, canPerformAction } from './move-options.ts'

export interface BoardProps {
  board: BoardResponse
  policy: PolicyDocument
  role: Role
  users: PickerUser[]
  today: string
  onOpenCard: (cardId: string) => void
  onMenuAction: (card: BoardCard, action: CardMenuAction) => void
}

/** The 7-lane board (presentational): affordances derive from the policy. */
export function Board({ board, policy, role, users, today, onOpenCard, onMenuAction }: BoardProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  useBoardAutoScroll(scrollRef)

  const usersById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users])
  // Explicit identity: this lands in dnd.ts effect deps — every new reference
  // tears down and re-registers all drop targets (possibly mid-drag), and the
  // React Compiler that would otherwise memoize it is off under Vitest.
  const canDropFrom = useCallback(
    (target: LaneKey) => (source: { cardId: string; laneKey: LaneKey }) =>
      canMoveToLane(policy, role, source.laneKey, target),
    [policy, role],
  )

  return (
    <div
      ref={scrollRef}
      className={classes.board}
      // A named landmark: aria-label on a role-less div is prohibited ARIA.
      role="region"
      aria-label={strings.board.boardLabel}
    >
      {board.lanes.map((snapshot) => (
        <LaneColumn
          key={snapshot.lane.id}
          snapshot={snapshot}
          usersById={usersById}
          today={today}
          canCancel={canPerformAction(policy, role, 'cancel')}
          canReopen={canPerformAction(policy, role, 'reopen')}
          canDropFrom={canDropFrom}
          onOpenCard={onOpenCard}
          onMenuAction={onMenuAction}
        />
      ))}
    </div>
  )
}
