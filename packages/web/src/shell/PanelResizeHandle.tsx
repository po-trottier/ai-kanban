import { strings } from '../strings.ts'
import { SIZES } from '../theme.ts'
import classes from './shell.module.css'
import { type ResizableWidth } from './use-card-panel-width.ts'

/** Arrow-key resize step (px) — a comfortable nudge for keyboard users. */
const KEYBOARD_STEP = 24

/**
 * The drag handle on the card panel's left edge (an ARIA window-splitter):
 * drag to resize, or focus it and use Left/Right arrows. The panel is on the
 * right, so Left widens it and Right narrows it.
 */
export function PanelResizeHandle({ resize }: { resize: ResizableWidth }) {
  return (
    <div
      className={classes.resizeHandle}
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={strings.detail.resizeLabel}
      aria-valuenow={resize.width}
      aria-valuemin={SIZES.cardPanelMinWidth}
      aria-valuemax={SIZES.cardPanelMaxWidth}
      onMouseDown={resize.onResizeStart}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          resize.nudge(KEYBOARD_STEP)
        } else if (event.key === 'ArrowRight') {
          event.preventDefault()
          resize.nudge(-KEYBOARD_STEP)
        }
      }}
    />
  )
}
