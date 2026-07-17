import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { type MouseEvent as ReactMouseEvent } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SIZES } from '../theme.ts'
import { PanelResizeHandle } from './PanelResizeHandle.tsx'
import { clampPanelWidth, panelMaxWidth, useCardPanelWidth } from './use-card-panel-width.ts'

const STORAGE_KEY = 'rivian-kanban:card-panel-width'

/** A minimal mouse-down event — the hook only reads clientX + preventDefault. */
function mouseDown(clientX: number): ReactMouseEvent {
  return { clientX, preventDefault: () => undefined } as unknown as ReactMouseEvent
}

/** Exercises the hook end-to-end (width readout + the real drag handle). */
function Harness() {
  const resize = useCardPanelWidth()
  return (
    <>
      <span data-testid="width">{resize.width}</span>
      <PanelResizeHandle resize={resize} />
    </>
  )
}

describe('useCardPanelWidth', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    localStorage.clear()
  })

  it('clamps candidate widths to [min, maxWidth] and rounds', () => {
    // Arrange — nothing to set up (pure function).
    // Act
    const belowMin = clampPanelWidth(10, 900)
    const aboveMax = clampPanelWidth(5000, 900)
    const rounded = clampPanelWidth(650.4, 900)
    const biggerMax = clampPanelWidth(5000, 1600)
    // Assert
    expect(belowMin).toBe(SIZES.cardPanelMinWidth)
    expect(aboveMax).toBe(900)
    expect(rounded).toBe(650)
    // A larger (viewport-relative) max lets the panel grow well past the old cap.
    expect(biggerMax).toBe(1600)
  })

  it('caps the max just short of the viewport, never below the minimum', () => {
    // Arrange — jsdom provides window.innerWidth
    // Act
    const max = panelMaxWidth()
    // Assert
    expect(max).toBeLessThan(window.innerWidth)
    expect(max).toBeGreaterThanOrEqual(SIZES.cardPanelMinWidth)
  })

  it('defaults to the configured width with no stored value', () => {
    // Arrange — storage cleared in beforeEach.
    // Act
    const { result } = renderHook(() => useCardPanelWidth())
    // Assert
    expect(result.current.width).toBe(SIZES.cardPanelWidth)
  })

  it('initializes from a persisted width (clamped)', () => {
    // Arrange
    localStorage.setItem(STORAGE_KEY, '700')
    // Act
    const { result } = renderHook(() => useCardPanelWidth())
    // Assert
    expect(result.current.width).toBe(700)
  })

  it('widens the panel when the handle is dragged left, and persists on release', () => {
    // Arrange
    const { result } = renderHook(() => useCardPanelWidth())
    // Act — press at x=1000, drag 100px left (panel on the right → wider), release
    act(() => {
      result.current.onResizeStart(mouseDown(1000))
    })
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 900 }))
    })
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup'))
    })
    // Assert
    expect(result.current.width).toBe(SIZES.cardPanelWidth + 100)
    expect(localStorage.getItem(STORAGE_KEY)).toBe(String(SIZES.cardPanelWidth + 100))
  })

  it('resizes from the handle with the arrow keys (left widens, right narrows)', () => {
    // Arrange
    render(<Harness />)
    const handle = screen.getByRole('separator', { name: /Resize the detail panel/ })
    expect(screen.getByTestId('width')).toHaveTextContent(String(SIZES.cardPanelWidth))
    // Act
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    // Assert — one step wider, and exposed on the splitter for assistive tech
    expect(screen.getByTestId('width')).toHaveTextContent(String(SIZES.cardPanelWidth + 24))
    expect(handle).toHaveAttribute('aria-valuenow', String(SIZES.cardPanelWidth + 24))
    // Act — arrow the other way past the start
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    // Assert
    expect(screen.getByTestId('width')).toHaveTextContent(String(SIZES.cardPanelWidth - 24))
  })
})
