/**
 * A tiny global undo/redo stack for NON-TEXT board actions (ITEM 86) — card
 * moves/reorders and lane/status transitions. Each entry carries its own
 * inverse and re-inverse closures, so the store stays domain-agnostic: it only
 * shuffles entries between the two stacks and runs their callbacks.
 *
 * Not a React store — there is no rendered UI that reflects the stacks, only the
 * global keyboard handler (`useUndoRedoKeys`) that pops them. So it is a plain
 * module singleton, reset between tests via `resetActionHistory`.
 *
 * Text edits (title, description, comments) are deliberately NOT recorded here:
 * those keep the browser's native in-field undo (the keyboard guard bails while
 * focus is in an editable element — see `is-editable-target.ts`).
 */
export interface UndoableAction {
  /** Reverses the action (e.g. move the card back to its prior lane + neighbors). */
  undo: () => Promise<void>
  /** Re-applies the action after an undo (reverses `undo`). */
  redo: () => Promise<void>
  /** Short human label for the announcement toast ("Move undone"). */
  label: string
}

const undoStack: UndoableAction[] = []
const redoStack: UndoableAction[] = []

/**
 * Records a freshly-performed undoable action and clears the redo stack — any
 * new action forks history, so the previously-undone branch is unreachable
 * (the standard undo model).
 */
export function pushAction(action: UndoableAction): void {
  undoStack.push(action)
  redoStack.length = 0
}

/**
 * Pops the newest action, runs its `undo`, and moves it to the redo stack.
 * Returns the entry (for its label) or null when there is nothing to undo.
 * On failure the entry is put back so a transient error is retryable — the
 * caller surfaces the error.
 */
export async function undoLast(): Promise<UndoableAction | null> {
  const action = undoStack.pop()
  if (action === undefined) return null
  try {
    await action.undo()
  } catch (error) {
    undoStack.push(action)
    throw error
  }
  redoStack.push(action)
  return action
}

/** Symmetric to `undoLast`: re-applies the newest undone action. */
export async function redoLast(): Promise<UndoableAction | null> {
  const action = redoStack.pop()
  if (action === undefined) return null
  try {
    await action.redo()
  } catch (error) {
    redoStack.push(action)
    throw error
  }
  undoStack.push(action)
  return action
}

/** Test-only: drops both stacks so one test's history never bleeds into the next. */
export function resetActionHistory(): void {
  undoStack.length = 0
  redoStack.length = 0
}
