import { type Board } from '@rivian-kanban/core'
import { createContext, useState } from 'react'

const STORAGE_KEY = 'rivian-kanban:selected-board'

export interface BoardScopeValue {
  /** The selected board, or null while the catalog is still loading/empty. */
  boardId: string | null
  /** Selects a board (persisted) — callers also reset board-scoped UI state. */
  setBoardId: (boardId: string) => void
}

/**
 * Provided once by `AppLayout`, so any descendant — the header switcher, the
 * Settings → Boards tab, a deep-linked `CardPanel` resolving a card's actual
 * board — can read/change the selection without threading props through the
 * route tree.
 */
export const BoardScopeContext = createContext<BoardScopeValue | null>(null)

function readStoredBoardId(): string | null {
  try {
    return globalThis.localStorage.getItem(STORAGE_KEY)
  } catch {
    // Private browsing / storage disabled: fall back to catalog defaults.
    return null
  }
}

function writeStoredBoardId(boardId: string): void {
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, boardId)
  } catch {
    // Selection just won't survive a reload.
  }
}

/** Logout clears the persisted selection, so the next sign-in re-resolves
 *  against that account's own catalog rather than the previous session's pick. */
export function clearStoredBoardSelection(): void {
  try {
    globalThis.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to clear.
  }
}

/** Prefer the server-resolved startup default; older stored choices are only a fallback. */
export function resolveSelectedBoardId(
  boards: readonly Board[],
  defaultBoardId?: string | null,
): string | null {
  if (defaultBoardId != null && boards.some((board) => board.id === defaultBoardId))
    return defaultBoardId
  const stored = readStoredBoardId()
  if (stored !== null && boards.some((board) => board.id === stored)) return stored
  return (boards.find((board) => board.isDefault) ?? boards[0])?.id ?? null
}

/**
 * Seeds the selection from the catalog and re-resolves it whenever the
 * catalog changes — so a revoked selection (the id drops out of `boards`)
 * recovers to another accessible board instead of sticking on a 403 (the
 * catalog itself refetches on window focus and on a poll interval, the
 * fallback for a dead/closed SSE stream).
 */
export function useSelectedBoardId(
  boards: readonly Board[] | undefined,
  defaultBoardId?: string | null,
): BoardScopeValue {
  const [boardId, setBoardIdState] = useState<string | null>(null)
  // Adjusting state during render, not in an effect (react.dev "Adjusting
  // state when a prop changes"): `seenBoards` only tracks whether `boards`
  // changed since the last render.
  const [seenBoards, setSeenBoards] = useState<readonly Board[] | undefined>(undefined)
  if (boards !== undefined && seenBoards !== boards) {
    setSeenBoards(boards)
    const stillAllowed = boardId !== null && boards.some((board) => board.id === boardId)
    if (!stillAllowed) setBoardIdState(resolveSelectedBoardId(boards, defaultBoardId))
  }

  const setBoardId = (next: string) => {
    setBoardIdState(next)
    writeStoredBoardId(next)
  }

  return { boardId, setBoardId }
}
