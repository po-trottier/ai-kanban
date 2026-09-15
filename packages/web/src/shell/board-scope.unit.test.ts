import { type Board } from '@rivian-kanban/core'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeBoardEntity } from '../test/fixtures.ts'
import {
  clearStoredBoardSelection,
  resolveSelectedBoardId,
  useSelectedBoardId,
} from './board-scope.ts'

const STORAGE_KEY = 'rivian-kanban:selected-board'

function board(overrides: Partial<Board> & { id: string }): Board {
  return makeBoardEntity({ name: 'Board', ...overrides })
}

describe('resolveSelectedBoardId', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    localStorage.clear()
  })

  it('picks the default board when nothing is stored', () => {
    // Arrange
    const boards = [board({ id: 'b1' }), board({ id: 'b2', isDefault: true })]
    // Act
    const resolved = resolveSelectedBoardId(boards)
    // Assert
    expect(resolved).toBe('b2')
  })

  it('uses the server-resolved default before a stored last-used board', () => {
    // Arrange
    localStorage.setItem(STORAGE_KEY, 'b1')
    const boards = [board({ id: 'b1', isDefault: true }), board({ id: 'b2' })]
    // Act
    // Assert
    expect(resolveSelectedBoardId(boards, 'b2')).toBe('b2')
    expect(resolveSelectedBoardId(boards, 'inaccessible')).toBe('b1')
  })

  it('falls back to the first board when none is marked default', () => {
    // Arrange
    const boards = [board({ id: 'b1' }), board({ id: 'b2' })]
    // Act
    const resolved = resolveSelectedBoardId(boards)
    // Assert
    expect(resolved).toBe('b1')
  })

  it('returns null when the catalog is empty (no accessible boards)', () => {
    // Arrange — nothing stored, empty catalog.
    // Act
    const resolved = resolveSelectedBoardId([])
    // Assert
    expect(resolved).toBeNull()
  })

  it('prefers the stored selection when it is still an allowed board', () => {
    // Arrange
    localStorage.setItem(STORAGE_KEY, 'b2')
    const boards = [board({ id: 'b1', isDefault: true }), board({ id: 'b2' })]
    // Act
    const resolved = resolveSelectedBoardId(boards)
    // Assert
    expect(resolved).toBe('b2')
  })

  it('discards a stored selection that has been revoked and recovers to the default', () => {
    // Arrange — selection revoked: 'gone' no longer appears in the catalog.
    localStorage.setItem(STORAGE_KEY, 'gone')
    const boards = [board({ id: 'b1', isDefault: true })]
    // Act
    const resolved = resolveSelectedBoardId(boards)
    // Assert
    expect(resolved).toBe('b1')
  })
})

describe('useSelectedBoardId', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    localStorage.clear()
  })

  it('re-resolves when the catalog changes and the current selection drops out', () => {
    // Arrange
    const initial = [board({ id: 'b1', isDefault: true }), board({ id: 'b2' })]
    const { result, rerender } = renderHook(
      ({ boards }: { boards: Board[] | undefined }) => useSelectedBoardId(boards),
      { initialProps: { boards: initial } },
    )
    act(() => {
      result.current.setBoardId('b2')
    })
    expect(result.current.boardId).toBe('b2')
    // Act — 'b2' is revoked from the catalog.
    rerender({ boards: [board({ id: 'b1', isDefault: true })] })
    // Assert
    expect(result.current.boardId).toBe('b1')
  })

  it('persists a selection to localStorage', () => {
    // Arrange
    const boards = [board({ id: 'b1' }), board({ id: 'b2' })]
    const { result } = renderHook(() => useSelectedBoardId(boards))
    // Act
    act(() => {
      result.current.setBoardId('b2')
    })
    // Assert
    expect(localStorage.getItem(STORAGE_KEY)).toBe('b2')
  })
})

describe('clearStoredBoardSelection', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    localStorage.clear()
  })

  it('removes the persisted selection (logout)', () => {
    // Arrange
    localStorage.setItem(STORAGE_KEY, 'b1')
    // Act
    clearStoredBoardSelection()
    // Assert
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})
