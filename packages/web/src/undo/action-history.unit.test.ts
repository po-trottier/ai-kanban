import { afterEach, describe, expect, it } from 'vitest'
import {
  pushAction,
  redoLast,
  resetActionHistory,
  undoLast,
  type UndoableAction,
} from './action-history.ts'

/** A recording entry whose undo/redo just append their name to a shared log. */
function entry(log: string[], name: string): UndoableAction {
  return {
    label: name,
    undo: () => {
      log.push(`undo:${name}`)
      return Promise.resolve()
    },
    redo: () => {
      log.push(`redo:${name}`)
      return Promise.resolve()
    },
  }
}

afterEach(() => {
  resetActionHistory()
})

describe('action-history', () => {
  it('undoLast pops the newest action and runs its undo', async () => {
    // Arrange
    const log: string[] = []
    pushAction(entry(log, 'a'))
    pushAction(entry(log, 'b'))
    // Act
    const returned = await undoLast()
    // Assert — LIFO: the last pushed is undone first
    expect(returned?.label).toBe('b')
    expect(log).toEqual(['undo:b'])
  })

  it('redoLast re-applies the most recently undone action', async () => {
    // Arrange
    const log: string[] = []
    pushAction(entry(log, 'a'))
    await undoLast()
    // Act
    const returned = await redoLast()
    // Assert
    expect(returned?.label).toBe('a')
    expect(log).toEqual(['undo:a', 'redo:a'])
  })

  it('returns null when there is nothing to undo or redo', async () => {
    // Arrange — the stacks are empty (reset between tests)
    // Act
    const undo = await undoLast()
    const redo = await redoLast()
    // Assert
    expect(undo).toBeNull()
    expect(redo).toBeNull()
  })

  it('clears the redo stack when a NEW action is performed after an undo', async () => {
    // Arrange — undo `a`, making it redoable
    const log: string[] = []
    pushAction(entry(log, 'a'))
    await undoLast()
    // Act — a new action forks history; the redone branch must be dropped
    pushAction(entry(log, 'b'))
    const redo = await redoLast()
    // Assert — nothing to redo; only `b` is now undoable
    expect(redo).toBeNull()
    const undo = await undoLast()
    expect(undo?.label).toBe('b')
  })

  it('re-undo after redo cycles the same entry between the stacks', async () => {
    // Arrange
    const log: string[] = []
    pushAction(entry(log, 'a'))
    // Act — undo, redo, undo again
    await undoLast()
    await redoLast()
    await undoLast()
    // Assert
    expect(log).toEqual(['undo:a', 'redo:a', 'undo:a'])
  })

  it('keeps the entry undoable when its undo throws (retryable)', async () => {
    // Arrange — an entry whose undo rejects the first time, then succeeds
    let attempts = 0
    pushAction({
      label: 'x',
      undo: () => {
        attempts += 1
        return attempts === 1 ? Promise.reject(new Error('nope')) : Promise.resolve()
      },
      redo: () => Promise.resolve(),
    })
    // Act — undo once (rejects), then undo again (the entry was put back)
    const first = undoLast()
    // Assert — the error surfaces, the entry is retryable, and the retry runs it
    await expect(first).rejects.toThrow('nope')
    expect(await undoLast()).not.toBeNull()
    expect(attempts).toBe(2)
  })
})
