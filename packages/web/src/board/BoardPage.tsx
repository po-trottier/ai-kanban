import {
  type BoardCard,
  type CancelResolution,
  type LaneKey,
  type WaitingReason,
} from '@rivian-kanban/core'
import { announce } from '@atlaskit/pragmatic-drag-and-drop-live-region'
import { useCallback, useState } from 'react'
import { Outlet, useNavigate } from 'react-router'
import { useBoard, useCardAction, useMoveCard } from '../api/board.ts'
import { isWaitingLane, laneKeyOfCard, type MoveIntent } from '../api/board-cache.ts'
import { usePolicy, useUsers } from '../api/meta.ts'
import { useCurrentUser } from '../auth/session-context.ts'
import { utcToday } from '../lib/format.ts'
import { BoardSkeleton } from '../shell/BoardSkeleton.tsx'
import { ErrorAlert } from '../shell/ErrorAlert.tsx'
import { strings } from '../strings.ts'
import { Board } from './Board.tsx'
import { BlockCardModal } from './BlockCardModal.tsx'
import { CancelCardModal } from './CancelCardModal.tsx'
import { type CardMenuAction } from './CardMenu.tsx'
import { MoveCardModal, type MoveSelection } from './MoveCardModal.tsx'
import { WaitingLaneModal } from './WaitingLaneModal.tsx'
import { useBoardDropMonitor } from './dnd.ts'
import { dropPosition, moveIntentFromDrop, type DropTarget } from './move-options.ts'

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
  const boardQuery = useBoard()
  const policyQuery = usePolicy()
  const usersQuery = useUsers()
  const cardAction = useCardAction()
  const moveCard = useMoveCard(({ announcement }) => {
    if (announcement !== undefined) announce(announcement)
  })
  const [modal, setModal] = useState<ModalState>({ kind: 'none' })

  const board = boardQuery.data

  /** Central move funnel: waiting-lane entry detours through the reason modal. */
  const requestMove = useCallback(
    (card: BoardCard, intent: MoveIntent, announcement?: string) => {
      const from = board === undefined ? null : laneKeyOfCard(board, card)
      if (isWaitingLane(intent.toLane) && (from === null || !isWaitingLane(from))) {
        setModal({
          kind: 'waiting',
          card,
          intent,
          ...(announcement === undefined ? {} : { announcement }),
        })
        return
      }
      moveCard.mutate({ card, intent, ...(announcement === undefined ? {} : { announcement }) })
    },
    [board, moveCard],
  )

  const onDrop = useCallback(
    (source: { cardId: string; laneKey: LaneKey }, target: DropTarget) => {
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

  if (boardQuery.isPending || policyQuery.isPending || usersQuery.isPending) {
    return <BoardSkeleton />
  }
  if (board === undefined || boardQuery.error !== null) {
    return <ErrorAlert error={boardQuery.error} fallbackMessage={strings.board.loadFailed} />
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
    const currentLane = laneKeyOfCard(board, card)
    switch (action) {
      case 'open':
        openCard(card.id)
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
        cardAction.mutate({ card, action: 'unblock' })
        break
      case 'reopen':
        cardAction.mutate({ card, action: 'reopen' })
        break
    }
  }

  const closeModal = () => {
    setModal({ kind: 'none' })
  }

  return (
    <>
      <Board
        board={board}
        policy={policyQuery.data}
        role={me.role}
        users={usersQuery.data}
        today={utcToday()}
        onOpenCard={openCard}
        onMenuAction={onMenuAction}
      />
      {modal.kind === 'move' ? (
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
            )
          }}
        />
      ) : null}
      {modal.kind === 'waiting' ? (
        <WaitingLaneModal
          onClose={closeModal}
          onSubmit={({
            waitingReason,
            expectedResumeAt,
          }: {
            waitingReason: WaitingReason
            expectedResumeAt: string
          }) => {
            closeModal()
            moveCard.mutate({
              card: modal.card,
              intent: { ...modal.intent, waitingReason, expectedResumeAt },
              ...(modal.announcement === undefined ? {} : { announcement: modal.announcement }),
            })
          }}
        />
      ) : null}
      {modal.kind === 'cancel' ? (
        <CancelCardModal
          onClose={closeModal}
          onSubmit={(resolution: CancelResolution) => {
            closeModal()
            cardAction.mutate({ card: modal.card, action: 'cancel', body: { resolution } })
          }}
        />
      ) : null}
      {modal.kind === 'block' ? (
        <BlockCardModal
          onClose={closeModal}
          onSubmit={(reason: string) => {
            closeModal()
            cardAction.mutate({ card: modal.card, action: 'block', body: { reason } })
          }}
        />
      ) : null}
      <Outlet />
    </>
  )
}
