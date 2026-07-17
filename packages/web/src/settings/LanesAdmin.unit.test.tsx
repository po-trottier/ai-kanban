import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createFakeFetch } from '../test/fake-fetch.ts'
import { laneByKey, makeBoard, nth } from '../test/fixtures.ts'
import { renderWithProviders } from '../test/render.tsx'
import { LanesAdmin } from './LanesAdmin.tsx'

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
})
