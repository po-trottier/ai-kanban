import {
  EMPTY_BOARD_FILTER,
  type BoardCard,
  type BoardFilter,
  type CancelResolution,
  type LaneKey,
  type WaitingReason,
} from '@rivian-kanban/core'
import { announce } from '@atlaskit/pragmatic-drag-and-drop-live-region'
import { useDebouncedValue } from '@mantine/hooks'
import { useCallback, useState } from 'react'
import { Outlet, useNavigate } from 'react-router'
import { isEmptyFilter, useBoard, useCardAction } from '../api/board.ts'
import { isWaitingLane, laneKeyOfCard, type MoveIntent } from '../api/board-cache.ts'
import { useLocations, usePolicy, useTags, useUsers } from '../api/meta.ts'
import { useCurrentUser } from '../auth/session-context.ts'
import { useUndoableBoard } from '../undo/use-undoable-board.ts'
import { utcToday } from '../lib/format.ts'
import { BoardSkeleton } from '../shell/BoardSkeleton.tsx'
import { ErrorAlert } from '../shell/ErrorAlert.tsx'
import { strings } from '../strings.ts'
import { Board } from './Board.tsx'
import { FilterBar } from './FilterBar.tsx'
import { BlockCardModal } from './BlockCardModal.tsx'
import { CancelCardModal } from './CancelCardModal.tsx'
import { type CardMenuAction } from './CardMenu.tsx'
import { MoveCardModal, type MoveSelection } from './MoveCardModal.tsx'
import { WaitingLaneModal } from './WaitingLaneModal.tsx'
import { useBoardDropMonitor } from './dnd.ts'
import { dropPosition, moveIntentFromDrop, type DropTarget } from './move-options.ts'

/** Debounce facet/text changes so a filtered fetch isn't fired on every keystroke. */
const FILTER_DEBOUNCE_MS = 300

type ModalState =
  | { kind: 'none' }
  | { kind: 'move'; card: BoardCard; currentLane: LaneKey }
  | { kind: 'waiting'; card: BoardCard; intent: MoveIntent; announcement?: string }
  | { kind: 'cancel'; card: BoardCard }
  | { kind: 'block'; card: BoardCard }

/** The board container: data, drag/menu move orchestration, card actions. */
export function BoardPage() {
  const navigate = useNavigate()
  const me = useCurrentUser()
  // The live filter the bar edits; the DEBOUNCED value drives the fetch so a
  // burst of facet/text edits collapses into one `POST /board/query`.
  const [filter, setFilter] = useState<BoardFilter>(EMPTY_BOARD_FILTER)
  const [debouncedFilter] = useDebouncedValue(filter, FILTER_DEBOUNCE_MS)
  const boardQuery = useBoard(debouncedFilter)
  const policyQuery = usePolicy()
  const usersQuery = useUsers()
  const tagsQuery = useTags()
  const locationsQuery = useLocations()
  const cardAction = useCardAction()
  // Undoable move + action wrappers (ITEM 86). The current policy + role are
  // handed in each render so the undo closures re-check permission FRESH at undo
  // time (both can change after an action) and skip a doomed inverse. The
  // debounced filter names the mounted board variant so optimistic drag/move
  // targets the exact filtered board cache.
  const { moveWithUndo, actionWithUndo } = useUndoableBoard(
    { policy: policyQuery.data, role: me.role },
    ({ announcement }) => {
      if (announcement !== undefined) announce(announcement)
    },
    debouncedFilter,
  )
  const [modal, setModal] = useState<ModalState>({ kind: 'none' })

  const board = boardQuery.data

  /** Central move funnel: waiting-lane entry detours through the reason modal. */
  const requestMove = useCallback(
    (card: BoardCard, intent: MoveIntent, announcement?: string, comment?: string) => {
      if (board === undefined) return
      const from = laneKeyOfCard(board, card)
      const laneLabel = board.lanes.find((snapshot) => snapshot.lane.key === intent.toLane)?.lane
        .label
      // The move modal now collects the waiting reason + resume date inline, so
      // an intent that already carries them skips the second modal entirely.
      const needsWaitingData =
        intent.waitingReason === undefined || intent.expectedResumeAt === undefined
      if (
        isWaitingLane(intent.toLane) &&
        needsWaitingData &&
        (from === null || !isWaitingLane(from))
      ) {
        setModal({
          kind: 'waiting',
          card,
          intent,
          ...(announcement === undefined ? {} : { announcement }),
        })
        return
      }
      // Route through the undoable wrapper, passing the PRE-move board snapshot
      // so the inverse (move back to the prior lane + neighbors) is captured.
      moveWithUndo(
        {
          card,
          intent,
          ...(announcement === undefined ? {} : { announcement }),
          ...(laneLabel === undefined ? {} : { laneLabel }),
          ...(comment === undefined ? {} : { comment }),
        },
        board,
      )
    },
    [board, moveWithUndo],
  )

  const onDrop = useCallback(
    (source: { cardId: number; laneKey: LaneKey }, target: DropTarget) => {
      if (board === undefined) return
      const card = board.lanes
        .flatMap((snapshot) => snapshot.cards)
        .find((candidate) => candidate.id === source.cardId)
      if (card === undefined) return
      const intent = moveIntentFromDrop(board, card.id, target)
      if (intent === null) return
      // Drag drops get the same live-region announcement as menu moves (ADR-007).
      const landing = dropPosition(board, card.id, intent)
      requestMove(
        card,
        intent,
        landing === null
          ? undefined
          : strings.card.moveAnnouncement(card.title, landing.laneLabel, landing.position),
      )
    },
    [board, requestMove],
  )
  useBoardDropMonitor(onDrop)

  // The essential once-per-session reads (policy + the user roster the affordances
  // and filter bar need). The board itself is per-filter and handled below so the
  // bar stays mounted across filter changes.
  if (policyQuery.isPending || usersQuery.isPending) {
    return <BoardSkeleton />
  }
  if (policyQuery.data === undefined || usersQuery.data === undefined) {
    return (
      <ErrorAlert
        error={policyQuery.error ?? usersQuery.error}
        fallbackMessage={strings.board.loadFailed}
      />
    )
  }

  const openCard = (cardId: string) => {
    void navigate(`/cards/${cardId}`)
  }

  const onMenuAction = (card: BoardCard, action: CardMenuAction) => {
    if (board === undefined) return
    const currentLane = laneKeyOfCard(board, card)
    switch (action) {
      case 'open':
        openCard(String(card.id))
        break
      case 'move':
        if (currentLane !== null) setModal({ kind: 'move', card, currentLane })
        break
      case 'cancel':
        setModal({ kind: 'cancel', card })
        break
      case 'block':
        setModal({ kind: 'block', card })
        break
      case 'unblock':
        actionWithUndo({ card, action: 'unblock' }, card)
        break
      case 'reopen':
        // Reopen is a recovery action, not undoable (see useUndoableBoard).
        cardAction.mutate({ card, action: 'reopen' })
        break
      case 'archive':
        actionWithUndo({ card, action: 'archive' }, card)
        break
    }
  }

  const closeModal = () => {
    setModal({ kind: 'none' })
  }

  // Whether the filter narrows anything (drives the per-lane match count + the
  // no-matches state). The board is fetched already narrowed by the server, so
  // there is no client-side re-filter — every rendered card is a real match.
  const filtering = !isEmptyFilter(debouncedFilter)
  // The round-trip is in flight when the first load has no data, or a filter
  // change is refetching over the retained previous board (keepPreviousData).
  const boardLoading =
    boardQuery.isPending || (boardQuery.isFetching && boardQuery.isPlaceholderData)

  return (
    <>
      <FilterBar
        filter={filter}
        onChange={setFilter}
        users={usersQuery.data}
        tags={(tagsQuery.data ?? []).map((tag) => tag.name)}
        locations={locationsQuery.data ?? []}
        currentUserId={me.id}
      />
      {board === undefined || boardQuery.error !== null ? (
        boardQuery.error !== null ? (
          <ErrorAlert error={boardQuery.error} fallbackMessage={strings.board.loadFailed} />
        ) : (
          <BoardSkeleton />
        )
      ) : (
        <Board
          board={board}
          filtering={filtering}
          loading={boardLoading}
          policy={policyQuery.data}
          role={me.role}
          users={usersQuery.data}
          today={utcToday()}
          onOpenCard={openCard}
          onMenuAction={onMenuAction}
        />
      )}
      {board !== undefined && modal.kind === 'move' ? (
        <MoveCardModal
          card={modal.card}
          currentLane={modal.currentLane}
          board={board}
          policy={policyQuery.data}
          role={me.role}
          onClose={closeModal}
          onSubmit={(selection: MoveSelection) => {
            closeModal()
            requestMove(
              modal.card,
              selection.intent,
              strings.card.moveAnnouncement(
                modal.card.title,
                selection.laneLabel,
                selection.position,
              ),
              selection.comment,
            )
          }}
        />
      ) : null}
      {board !== undefined && modal.kind === 'waiting' ? (
        <WaitingLaneModal
          onClose={closeModal}
          onSubmit={({
            waitingReason,
            expectedResumeAt,
            comment,
          }: {
            waitingReason: WaitingReason
            expectedResumeAt: string
            comment?: string
          }) => {
            closeModal()
            moveWithUndo(
              {
                card: modal.card,
                intent: { ...modal.intent, waitingReason, expectedResumeAt },
                ...(modal.announcement === undefined ? {} : { announcement: modal.announcement }),
                laneLabel:
                  board.lanes.find((snapshot) => snapshot.lane.key === modal.intent.toLane)?.lane
                    .label ?? strings.laneNames.waiting_parts_vendor,
                ...(comment === undefined ? {} : { comment }),
              },
              board,
            )
          }}
        />
      ) : null}
      {modal.kind === 'cancel' ? (
        <CancelCardModal
          onClose={closeModal}
          onSubmit={(resolution: CancelResolution) => {
            closeModal()
            actionWithUndo({ card: modal.card, action: 'cancel', body: { resolution } }, modal.card)
          }}
        />
      ) : null}
      {modal.kind === 'block' ? (
        <BlockCardModal
          onClose={closeModal}
          onSubmit={(reason: string) => {
            closeModal()
            actionWithUndo({ card: modal.card, action: 'block', body: { reason } }, modal.card)
          }}
        />
      ) : null}
      <Outlet />
    </>
  )
}
