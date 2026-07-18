import { announce } from '@atlaskit/pragmatic-drag-and-drop-live-region'
import { useEffect } from 'react'
import { notifyError, notifySuccess } from '../api/notify.ts'
import { strings } from '../strings.ts'
import { redoLast, undoLast } from './action-history.ts'
import { isEditableTarget } from './is-editable-target.ts'

/**
 * Wires the global keyboard undo/redo for non-text board actions (ITEM 86),
 * mounted once on the authenticated shell:
 *   - Ctrl/Cmd+Z              → undo
 *   - Ctrl/Cmd+Y              → redo
 *   - Ctrl/Cmd+Shift+Z        → redo
 *
 * CRITICAL GUARD: while focus sits in an editable element (input, textarea,
 * contenteditable — the rich-text description, comments), we do NOTHING and let
 * the event through, so the browser's native in-field text undo/redo is never
 * hijacked. Only when focus is elsewhere do we handle the chord and
 * `preventDefault` it.
 *
 * Each undo/redo is announced twice: a visible teal toast (a non-technical user
 * needs to see the action reversed) and the live region (screen readers).
 */
export function useUndoRedoKeys(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // Modifier must be the platform's primary (Ctrl on Windows/Linux, Cmd on
      // macOS); a bare Z/Y is a normal keystroke.
      if (!(event.metaKey || event.ctrlKey)) return
      const key = event.key.toLowerCase()
      const isUndo = key === 'z' && !event.shiftKey
      const isRedo = key === 'y' || (key === 'z' && event.shiftKey)
      if (!isUndo && !isRedo) return

      // The guard: never steal native text undo/redo from an editable field.
      if (isEditableTarget(event.target)) return

      event.preventDefault()
      void run(isUndo ? 'undo' : 'redo')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])
}

/** Runs one undo or redo, announcing the outcome (or that there was nothing / it failed). */
async function run(direction: 'undo' | 'redo'): Promise<void> {
  try {
    const entry = await (direction === 'undo' ? undoLast() : redoLast())
    if (entry === null) {
      const message = direction === 'undo' ? strings.undo.nothingToUndo : strings.undo.nothingToRedo
      announce(message)
      return
    }
    const message =
      direction === 'undo' ? strings.undo.undone(entry.label) : strings.undo.redone(entry.label)
    notifySuccess(message)
    announce(message)
  } catch (error) {
    // A doomed inverse (RBAC no longer permits it, a stale conflict) surfaces as
    // a calm toast rather than a silent no-op — the underlying mutation already
    // rolled its optimistic cache back.
    notifyError(error)
  }
}
