import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { MantineProvider } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import { pushAction, resetActionHistory, type UndoableAction } from './action-history.ts'
import { isEditableTarget } from './is-editable-target.ts'
import { useUndoRedoKeys } from './use-undo-redo-keys.ts'

/** A component that mounts the global keys and offers a plain button + a text field to focus. */
function Harness() {
  useUndoRedoKeys()
  return (
    <MantineProvider env="test">
      <Notifications />
      <button type="button">focusable</button>
      <input aria-label="a field" />
      <textarea aria-label="a note" />
    </MantineProvider>
  )
}

/** A recording undoable action whose undo/redo push onto a shared log. */
function recording(log: string[]): UndoableAction {
  return {
    label: 'card move',
    undo: () => {
      log.push('undo')
      return Promise.resolve()
    },
    redo: () => {
      log.push('redo')
      return Promise.resolve()
    },
  }
}

afterEach(() => {
  resetActionHistory()
})

describe('isEditableTarget', () => {
  it('is true for inputs, textareas, selects', () => {
    // Arrange
    const input = document.createElement('input')
    const textarea = document.createElement('textarea')
    const select = document.createElement('select')
    // Act
    const results = [input, textarea, select].map(isEditableTarget)
    // Assert
    expect(results).toEqual([true, true, true])
  })

  it('is true inside a contenteditable region (host and descendant)', () => {
    // Arrange — a contenteditable host with a nested node (the caret can sit deep)
    const host = document.createElement('div')
    host.setAttribute('contenteditable', 'true')
    const child = document.createElement('span')
    host.append(child)
    document.body.append(host)
    // Act — happy-dom derives isContentEditable from the host down
    const results = [isEditableTarget(host), isEditableTarget(child)]
    host.remove()
    // Assert
    expect(results).toEqual([true, true])
  })

  it('is false for a plain button or a null target', () => {
    // Arrange
    const button = document.createElement('button')
    // Act
    const results = [isEditableTarget(button), isEditableTarget(null)]
    // Assert
    expect(results).toEqual([false, false])
  })
})

describe('useUndoRedoKeys', () => {
  it('undoes on Ctrl+Z when focus is NOT in an editable element', async () => {
    // Arrange
    const user = userEvent.setup()
    const log: string[] = []
    render(<Harness />)
    pushAction(recording(log))
    await user.click(screen.getByRole('button', { name: 'focusable' }))
    // Act
    await user.keyboard('{Control>}z{/Control}')
    // Assert
    await waitFor(() => {
      expect(log).toEqual(['undo'])
    })
  })

  it('redoes on Ctrl+Y and on Ctrl+Shift+Z', async () => {
    // Arrange — one action already undone (so it is redoable)
    const user = userEvent.setup()
    const log: string[] = []
    render(<Harness />)
    pushAction(recording(log))
    await user.click(screen.getByRole('button', { name: 'focusable' }))
    await user.keyboard('{Control>}z{/Control}')
    await waitFor(() => {
      expect(log).toEqual(['undo'])
    })
    // Act — Ctrl+Y redoes
    await user.keyboard('{Control>}y{/Control}')
    await waitFor(() => {
      expect(log).toEqual(['undo', 'redo'])
    })
    // Act — undo again, then Ctrl+Shift+Z also redoes
    await user.keyboard('{Control>}z{/Control}')
    await waitFor(() => {
      expect(log).toEqual(['undo', 'redo', 'undo'])
    })
    await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}')
    // Assert
    await waitFor(() => {
      expect(log).toEqual(['undo', 'redo', 'undo', 'redo'])
    })
  })

  it('does NOT hijack Ctrl+Z while focus is in a text input (native undo survives)', async () => {
    // Arrange
    const user = userEvent.setup()
    const log: string[] = []
    render(<Harness />)
    pushAction(recording(log))
    await user.click(screen.getByRole('textbox', { name: 'a field' }))
    // Act — the guard must let the browser keep this keystroke
    await user.keyboard('{Control>}z{/Control}')
    // Assert — our undo never ran
    expect(log).toEqual([])
  })

  it('does NOT hijack Ctrl+Z while focus is in a textarea', async () => {
    // Arrange
    const user = userEvent.setup()
    const log: string[] = []
    render(<Harness />)
    pushAction(recording(log))
    await user.click(screen.getByRole('textbox', { name: 'a note' }))
    // Act
    await user.keyboard('{Control>}z{/Control}')
    // Assert
    expect(log).toEqual([])
  })

  it('ignores a bare Z with no modifier', async () => {
    // Arrange
    const user = userEvent.setup()
    const log: string[] = []
    render(<Harness />)
    pushAction(recording(log))
    await user.click(screen.getByRole('button', { name: 'focusable' }))
    // Act
    await user.keyboard('z')
    // Assert
    expect(log).toEqual([])
  })
})
