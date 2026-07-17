import { useCallback, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { SIZES } from '../theme.ts'

/** Persist the user's chosen panel width so it sticks across sessions. */
const STORAGE_KEY = 'rivian-kanban:card-panel-width'

/** Clamp a candidate width into the readable, on-screen drag bounds (ADR-016 tokens). */
export function clampPanelWidth(width: number): number {
  return Math.max(SIZES.cardPanelMinWidth, Math.min(SIZES.cardPanelMaxWidth, Math.round(width)))
}

function readStoredWidth(): number {
  try {
    const raw = globalThis.localStorage.getItem(STORAGE_KEY)
    const parsed = raw === null ? NaN : Number(raw)
    return Number.isFinite(parsed) ? clampPanelWidth(parsed) : SIZES.cardPanelWidth
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

    const onMove = (move: MouseEvent) => {
      // Panel is on the right: moving left (smaller clientX) makes it wider.
      const next = clampPanelWidth(startWidth + (startX - move.clientX))
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
      const next = clampPanelWidth(current + delta)
      latest.current = next
      persistWidth(next)
      return next
    })
  }, [])

  return { width, onResizeStart, nudge, resizing }
}
