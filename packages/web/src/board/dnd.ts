import { type Card, type LaneKey } from '@rivian-kanban/core'
import { autoScrollForElements } from '@atlaskit/pragmatic-drag-and-drop-auto-scroll/element'
import {
  attachClosestEdge,
  extractClosestEdge,
} from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge'
import { type Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/types'
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine'
import {
  draggable,
  dropTargetForElements,
  monitorForElements,
} from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { setCustomNativeDragPreview } from '@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview'
import { useEffect, useState, type RefObject } from 'react'
import { resolveDropTarget, type DropTarget } from './move-options.ts'

/**
 * The one thin adapter over Pragmatic drag-and-drop (ADR-007): all engine
 * wiring lives here so a future swap stays contained. Everything else on the
 * board consumes plain callbacks and state.
 *
 * Not unit-tested: native HTML5 drag events do not exist in happy-dom; the
 * real drag path is covered by Playwright (docs/dev/testing.md pyramid).
 */

const CARD_DATA_TYPE = 'rivian-kanban/card'

interface CardDragData extends Record<string | symbol, unknown> {
  type: typeof CARD_DATA_TYPE
  cardId: string
  laneKey: LaneKey
}

function isCardDragData(data: Record<string | symbol, unknown>): data is CardDragData {
  return data.type === CARD_DATA_TYPE
}

export interface CardDndState {
  dragging: boolean
  closestEdge: Edge | null
}

const idleCardState: CardDndState = { dragging: false, closestEdge: null }

/** Makes a card draggable and a drop target reporting the closest top/bottom edge. */
export function useCardDnd(
  ref: RefObject<HTMLElement | null>,
  card: Card,
  laneKey: LaneKey,
  canDrop: (source: { cardId: string; laneKey: LaneKey }) => boolean,
): CardDndState {
  const [state, setState] = useState<CardDndState>(idleCardState)

  useEffect(() => {
    const element = ref.current
    if (element === null) return
    const data: CardDragData = { type: CARD_DATA_TYPE, cardId: card.id, laneKey }
    return combine(
      draggable({
        element,
        getInitialData: () => data,
        onGenerateDragPreview: ({ nativeSetDragImage, location, source }) => {
          // Clone the styled card so the native preview is never clipped (ADR-016 note).
          setCustomNativeDragPreview({
            nativeSetDragImage,
            render: ({ container }) => {
              const rect = source.element.getBoundingClientRect()
              const preview = source.element.cloneNode(true) as HTMLElement
              preview.style.width = `${String(rect.width)}px`
              preview.style.transform = `translate(-${String(
                location.current.input.clientX - rect.x,
              )}px, -${String(location.current.input.clientY - rect.y)}px)`
              container.appendChild(preview)
            },
          })
        },
        onDragStart: () => {
          setState((current) => ({ ...current, dragging: true }))
        },
        onDrop: () => {
          setState(idleCardState)
        },
      }),
      dropTargetForElements({
        element,
        // The source card stays a valid target of itself (Atlassian board
        // pattern): an in-place drop then resolves to the card, which
        // moveIntentFromDrop treats as a no-op instead of a lane-bottom move.
        canDrop: ({ source }) =>
          isCardDragData(source.data) &&
          canDrop({ cardId: source.data.cardId, laneKey: source.data.laneKey }),
        getData: ({ input, element: el }) =>
          attachClosestEdge(
            { cardId: card.id, laneKey },
            {
              input,
              element: el,
              allowedEdges: ['top', 'bottom'],
            },
          ),
        getIsSticky: () => true,
        onDrag: ({ self }) => {
          setState((current) => ({ ...current, closestEdge: extractClosestEdge(self.data) }))
        },
        onDragLeave: () => {
          setState((current) => ({ ...current, closestEdge: null }))
        },
        onDrop: () => {
          setState(idleCardState)
        },
      }),
    )
  }, [ref, card.id, laneKey, canDrop])

  return state
}

/**
 * Registers a lane's scroll container (a plain `overflow-y: auto` element —
 * not Mantine ScrollArea, ADR-016) as a drop target with auto-scroll.
 */
export function useLaneDnd(
  ref: RefObject<HTMLElement | null>,
  laneKey: LaneKey,
  canDrop: (source: { cardId: string; laneKey: LaneKey }) => boolean,
): { isDropTarget: boolean } {
  const [isDropTarget, setIsDropTarget] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (element === null) return
    return combine(
      dropTargetForElements({
        element,
        canDrop: ({ source }) =>
          isCardDragData(source.data) &&
          canDrop({ cardId: source.data.cardId, laneKey: source.data.laneKey }),
        getData: () => ({ laneKey }),
        onDragEnter: () => {
          setIsDropTarget(true)
        },
        onDragLeave: () => {
          setIsDropTarget(false)
        },
        onDrop: () => {
          setIsDropTarget(false)
        },
      }),
      autoScrollForElements({ element }),
    )
  }, [ref, laneKey, canDrop])

  return { isDropTarget }
}

/** Registers the horizontal board scroller for auto-scroll while dragging. */
export function useBoardAutoScroll(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const element = ref.current
    if (element === null) return
    return autoScrollForElements({ element })
  }, [ref])
}

/** Watches all card drops and reports the resolved target to the board. */
export function useBoardDropMonitor(
  onDrop: (source: { cardId: string; laneKey: LaneKey }, target: DropTarget) => void,
): void {
  useEffect(
    () =>
      monitorForElements({
        canMonitor: ({ source }) => isCardDragData(source.data),
        onDrop: ({ source, location }) => {
          if (!isCardDragData(source.data)) return
          const target = resolveDropTarget(location.current.dropTargets)
          if (target === null) return
          onDrop({ cardId: source.data.cardId, laneKey: source.data.laneKey }, target)
        },
      }),
    [onDrop],
  )
}
