import { useCallback, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { SIZES } from '../theme.ts'

/** Persist the user's chosen panel width so it sticks across sessions. */
const STORAGE_KEY = 'rivian-kanban:card-panel-width'

/** Clamp a candidate width into [min, maxWidth] (rounded). The max is dynamic
 * (viewport-relative) so the panel can grow to nearly the whole screen. */
export function clampPanelWidth(width: number, maxWidth: number): number {
  return Math.max(SIZES.cardPanelMinWidth, Math.min(maxWidth, Math.round(width)))
}

/** The largest the panel may grow: almost the whole viewport, leaving a sliver
 * of board. Falls back to the static cap when the viewport width is unknown. */
export function panelMaxWidth(): number {
  const viewport = globalThis.innerWidth
  const base = Number.isFinite(viewport) && viewport > 0 ? viewport : SIZES.cardPanelMaxWidth
  return Math.max(SIZES.cardPanelMinWidth, base - SIZES.cardPanelMinBoardVisible)
}

function readStoredWidth(): number {
  try {
    const raw = globalThis.localStorage.getItem(STORAGE_KEY)
    const parsed = raw === null ? NaN : Number(raw)
    return Number.isFinite(parsed) ? clampPanelWidth(parsed, panelMaxWidth()) : SIZES.cardPanelWidth
  } catch {
    // Private-mode / disabled storage — fall back to the default width.
    return SIZES.cardPanelWidth
  }
}

function persistWidth(width: number): void {
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, String(width))
  } catch {
    // Best-effort: a failed write just means the width won't survive a reload.
  }
}

export interface ResizableWidth {
  width: number
  /** Current maximum (viewport-relative) — for the handle's aria-valuemax. */
  maxWidth: number
  /** Begin a drag from the panel's left-edge handle (mouse-tracked on window). */
  onResizeStart: (event: ReactMouseEvent) => void
  /** Keyboard resize: `delta` px added to the width (clamped, persisted). */
  nudge: (delta: number) => void
  resizing: boolean
}

/**
 * Width state for the docked card-detail panel, draggable via a left-edge
 * handle and persisted to localStorage. The panel sits on the RIGHT, so
 * dragging the handle left (clientX decreases) widens it; the result is clamped
 * to the readable min/max bounds. Persisted on drag end, not per frame.
 *
 * Mouse (not pointer) events: the handle is desktop-only (hidden below the
 * full-screen breakpoint), and mouse events fire reliably for mouse input in
 * every browser and headless driver.
 */
export function useCardPanelWidth(): ResizableWidth {
  const [width, setWidth] = useState<number>(readStoredWidth)
  const [resizing, setResizing] = useState(false)
  const latest = useRef(width)

  const onResizeStart = useCallback((event: ReactMouseEvent) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = latest.current
    setResizing(true)

    const maxWidth = panelMaxWidth()
    const onMove = (move: MouseEvent) => {
      // Panel is on the right: moving left (smaller clientX) makes it wider.
      const next = clampPanelWidth(startWidth + (startX - move.clientX), maxWidth)
      latest.current = next
      setWidth(next)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setResizing(false)
      persistWidth(latest.current)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  const nudge = useCallback((delta: number) => {
    setWidth((current) => {
      const next = clampPanelWidth(current + delta, panelMaxWidth())
      latest.current = next
      persistWidth(next)
      return next
    })
  }, [])

  return { width, maxWidth: panelMaxWidth(), onResizeStart, nudge, resizing }
}
