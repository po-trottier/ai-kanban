import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { type BoardResponse } from '../api/schemas.ts'
import { createFakeFetch } from '../test/fake-fetch.ts'
import { laneByKey, makeBoard, nth, uid } from '../test/fixtures.ts'
import { renderWithProviders } from '../test/render.tsx'
import { LanesAdmin } from './LanesAdmin.tsx'

/** A board with one extra admin-added (non-seeded) column appended. */
function boardWithCustomLane(): { board: BoardResponse; customId: string } {
  const base = makeBoard({})
  const customId = uid(500)
  const board: BoardResponse = {
    lanes: [
      ...base.lanes,
      {
        lane: {
          id: customId,
          boardId: uid(1),
          key: 'on_hold',
          label: 'On Hold',
          position: 7,
          wipLimit: null,
        },
        cards: [],
        wipLimitExceeded: false,
      },
    ],
  }
  return { board, customId }
}

describe('LanesAdmin', () => {
  it('renders an aligned table with one editable row per lane', async () => {
    // Arrange
    const fake = createFakeFetch({ 'GET /api/v1/board': makeBoard({}) })
    // Act
    renderWithProviders(<LanesAdmin />, { fetchFn: fake.fetch })
    // Assert — one friendly 'Column' header (no raw-key column) plus the
    // machine key kept as a dimmed secondary line under each editable label.
    expect(await screen.findByDisplayValue('Intake')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Column' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'WIP limit' })).toBeInTheDocument()
    expect(screen.getByText('waiting_parts_vendor')).toBeInTheDocument()
    expect(screen.getAllByRole('textbox', { name: /Column label/ })).toHaveLength(7)
    expect(screen.getByRole('textbox', { name: 'WIP limit (in_progress)' })).toHaveValue('3')
  })

  it('patches the lane with the edited label and WIP limit', async () => {
    // Arrange
    const user = userEvent.setup()
    const ready = laneByKey('ready')
    const fake = createFakeFetch({
      'GET /api/v1/board': makeBoard({}),
      [`PATCH /api/v1/lanes/${ready.id}`]: { ...ready, label: 'Approved', wipLimit: 9 },
    })
    renderWithProviders(<LanesAdmin />, { fetchFn: fake.fetch })
    // Act
    const label = await screen.findByRole('textbox', { name: 'Column label (ready)' })
    await user.clear(label)
    await user.type(label, 'Approved')
    await user.type(screen.getByRole('textbox', { name: 'WIP limit (ready)' }), '9')
    await user.click(nth(screen.getAllByRole('button', { name: 'Save' }), 2))
    // Assert
    expect(fake.lastBody('PATCH', `/api/v1/lanes/${ready.id}`)).toEqual({
      label: 'Approved',
      wipLimit: 9,
    })
  })

  it('reorders a column by moving it and posts the new order', async () => {
    // Arrange
    const user = userEvent.setup()
    const fake = createFakeFetch({
      'GET /api/v1/board': makeBoard({}),
      'POST /api/v1/lanes/reorder': makeBoard({}).lanes.map((entry) => entry.lane),
    })
    renderWithProviders(<LanesAdmin />, { fetchFn: fake.fetch })
    // Act — move the first column (Intake) one step right.
    await user.click(await screen.findByRole('button', { name: 'Move this column right (Intake)' }))
    // Assert — the full order is posted with Intake and its neighbor swapped.
    const expected = [
      'waiting_approval',
      'intake',
      'ready',
      'in_progress',
      'waiting_parts_vendor',
      'review',
      'done',
    ].map((key) => laneByKey(key).id)
    expect(fake.lastBody('POST', '/api/v1/lanes/reorder')).toEqual({ orderedIds: expected })
  })

  it('adds a new column from the label field', async () => {
    // Arrange
    const user = userEvent.setup()
    const fake = createFakeFetch({
      'GET /api/v1/board': makeBoard({}),
      'POST /api/v1/lanes': { ...laneByKey('intake'), key: 'on_hold', label: 'On Hold' },
    })
    renderWithProviders(<LanesAdmin />, { fetchFn: fake.fetch })
    // Act
    await user.type(await screen.findByRole('textbox', { name: 'Add a column' }), 'On Hold')
    await user.click(screen.getByRole('button', { name: 'Add column' }))
    // Assert
    expect(fake.lastBody('POST', '/api/v1/lanes')).toEqual({ label: 'On Hold', wipLimit: null })
  })

  it('deletes an admin column but disables delete for the built-in ones', async () => {
    // Arrange
    const user = userEvent.setup()
    const { board, customId } = boardWithCustomLane()
    const fake = createFakeFetch({
      'GET /api/v1/board': board,
      [`DELETE /api/v1/lanes/${customId}`]: {},
    })
    renderWithProviders(<LanesAdmin />, { fetchFn: fake.fetch })
    // Assert — a seeded column's delete is disabled; the admin one is not.
    expect(
      await screen.findByRole('button', { name: 'Delete this column (Intake)' }),
    ).toBeDisabled()
    // Act — delete the admin-added column.
    await user.click(screen.getByRole('button', { name: 'Delete this column (On Hold)' }))
    // Assert
    expect(fake.calls.some((call) => call.method === 'DELETE' && call.url.includes(customId))).toBe(
      true,
    )
  })
})
