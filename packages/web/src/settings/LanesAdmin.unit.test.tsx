import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { type BoardResponse } from '../api/schemas.ts'
import { createFakeFetch } from '../test/fake-fetch.ts'
import { laneByKey, makeBoard, nth, uid } from '../test/fixtures.ts'
import { renderWithProviders } from '../test/render.tsx'
import { LanesAdmin } from './LanesAdmin.tsx'
import { reorderedLaneIds } from './lane-reorder.ts'

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
  it('renders an aligned table with one drag-handled row per lane and no machine key', async () => {
    // Arrange
    const fake = createFakeFetch({ 'GET /api/v1/board': makeBoard({}) })
    // Act
    renderWithProviders(<LanesAdmin />, { fetchFn: fake.fetch })
    // Assert — friendly headers, an editable label per lane, a grip handle per
    // lane, and the machine key nowhere on screen (it has no user value).
    expect(await screen.findByDisplayValue('Intake')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Order' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Column' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'WIP limit' })).toBeInTheDocument()
    expect(screen.queryByText('waiting_parts_vendor')).not.toBeInTheDocument()
    expect(screen.getAllByRole('textbox', { name: /Column label/ })).toHaveLength(7)
    expect(screen.getAllByRole('button', { name: /^Reorder / })).toHaveLength(7)
    expect(screen.getByRole('textbox', { name: 'WIP limit (In Progress)' })).toHaveValue('3')
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
    const label = await screen.findByRole('textbox', { name: 'Column label (Ready)' })
    await user.clear(label)
    await user.type(label, 'Approved')
    await user.type(screen.getByRole('textbox', { name: 'WIP limit (Ready)' }), '9')
    await user.click(nth(screen.getAllByRole('button', { name: 'Save' }), 2))
    // Assert
    expect(fake.lastBody('PATCH', `/api/v1/lanes/${ready.id}`)).toEqual({
      label: 'Approved',
      wipLimit: 9,
    })
  })

  it('computes the reordered id list a drag-drop posts (source dropped below its target)', () => {
    // Arrange — the seeded order; drag Intake (first) onto the bottom edge of
    // In Progress (the drop the grip-handle drag performs).
    const orderedIds = makeBoard({}).lanes.map((entry) => entry.lane.id)
    const intakeId = laneByKey('intake').id
    const inProgressId = laneByKey('in_progress').id
    // Act
    const next = reorderedLaneIds(orderedIds, intakeId, inProgressId, 'bottom')
    // Assert — Intake lands just after In Progress; every other id keeps its order.
    expect(next).toEqual(
      [
        'waiting_approval',
        'ready',
        'in_progress',
        'intake',
        'waiting_parts_vendor',
        'review',
        'done',
      ].map((key) => laneByKey(key).id),
    )
  })

  it('returns the same list reference for an in-place drop (no reorder request)', () => {
    // Arrange
    const orderedIds = makeBoard({}).lanes.map((entry) => entry.lane.id)
    const intakeId = laneByKey('intake').id
    // Act — dropping Intake onto its own top edge is a no-op.
    const next = reorderedLaneIds(orderedIds, intakeId, intakeId, 'top')
    // Assert
    expect(next).toBe(orderedIds)
  })

  it('adds a new column from the top-right button with a default label', async () => {
    // Arrange
    const user = userEvent.setup()
    const fake = createFakeFetch({
      'GET /api/v1/board': makeBoard({}),
      'POST /api/v1/lanes': { ...laneByKey('intake'), key: 'new_column', label: 'New column' },
    })
    renderWithProviders(<LanesAdmin />, { fetchFn: fake.fetch })
    // Act — one click, no name field: the column is added with a default label.
    await user.click(await screen.findByRole('button', { name: 'Add' }))
    // Assert
    expect(fake.lastBody('POST', '/api/v1/lanes')).toEqual({
      label: 'New column',
      wipLimit: null,
    })
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
    // Act — delete the admin-added column, confirming the guard dialog.
    await user.click(screen.getByRole('button', { name: 'Delete this column (On Hold)' }))
    await user.click(await screen.findByRole('button', { name: 'Delete column' }))
    // Assert
    expect(fake.calls.some((call) => call.method === 'DELETE' && call.url.includes(customId))).toBe(
      true,
    )
  })
})
