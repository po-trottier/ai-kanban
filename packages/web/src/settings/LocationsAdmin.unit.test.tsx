import { type Location } from '@rivian-kanban/core'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createFakeFetch, problemResponse } from '../test/fake-fetch.ts'
import { uid } from '../test/fixtures.ts'
import { renderWithProviders } from '../test/render.tsx'
import { strings } from '../strings.ts'
import { LocationsAdmin } from './LocationsAdmin.tsx'

const building: Location = { id: uid(91), parentId: null, kind: 'building', name: 'HQ' }
const floor: Location = { id: uid(92), parentId: building.id, kind: 'floor', name: 'Floor 2' }

describe('LocationsAdmin', () => {
  it('renders the location tree with per-node actions', async () => {
    // Arrange
    const fake = createFakeFetch({ 'GET /api/v1/locations': [building, floor] })
    // Act
    renderWithProviders(<LocationsAdmin />, { fetchFn: fake.fetch })
    // Assert
    expect(await screen.findByText('HQ')).toBeInTheDocument()
    expect(screen.getByLabelText('Add inside HQ')).toBeInTheDocument()
    expect(screen.getByLabelText('Rename HQ')).toBeInTheDocument()
    expect(screen.getByLabelText('Delete HQ')).toBeInTheDocument()
  })

  it('creates a root building via Add building', async () => {
    // Arrange
    const user = userEvent.setup()
    const fake = createFakeFetch({
      'GET /api/v1/locations': [],
      'POST /api/v1/locations': { id: uid(93), parentId: null, kind: 'building', name: 'Annex' },
    })
    renderWithProviders(<LocationsAdmin />, { fetchFn: fake.fetch })
    // Act
    await user.click(await screen.findByRole('button', { name: 'Add building' }))
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Annex')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    // Assert
    expect(fake.lastBody('POST', '/api/v1/locations')).toEqual({
      parentId: null,
      kind: 'building',
      name: 'Annex',
    })
  })

  it('adds a floor inside a building (kind derived from the parent)', async () => {
    // Arrange
    const user = userEvent.setup()
    const fake = createFakeFetch({
      'GET /api/v1/locations': [building],
      'POST /api/v1/locations': { id: uid(94), parentId: building.id, kind: 'floor', name: 'F3' },
    })
    renderWithProviders(<LocationsAdmin />, { fetchFn: fake.fetch })
    // Act
    await user.click(await screen.findByLabelText('Add inside HQ'))
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'F3')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    // Assert
    expect(fake.lastBody('POST', '/api/v1/locations')).toEqual({
      parentId: building.id,
      kind: 'floor',
      name: 'F3',
    })
  })

  it('renames a location through its node action', async () => {
    // Arrange
    const user = userEvent.setup()
    const fake = createFakeFetch({
      'GET /api/v1/locations': [building],
      [`PATCH /api/v1/locations/${building.id}`]: { ...building, name: 'HQ West' },
    })
    renderWithProviders(<LocationsAdmin />, { fetchFn: fake.fetch })
    // Act
    await user.click(await screen.findByLabelText('Rename HQ'))
    const nameInput = screen.getByRole('textbox', { name: 'Name' })
    await user.clear(nameInput)
    await user.type(nameInput, 'HQ West')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    // Assert
    expect(fake.lastBody('PATCH', `/api/v1/locations/${building.id}`)).toEqual({ name: 'HQ West' })
  })

  it('shows a friendly inline error when the server rejects a duplicate sibling name on create', async () => {
    // Arrange — the server returns a 409 conflict for the duplicate name.
    const user = userEvent.setup()
    const fake = createFakeFetch({
      'GET /api/v1/locations': [building],
      'POST /api/v1/locations': () =>
        problemResponse(409, { type: 'urn:rivian-kanban:problem:conflict', title: 'Conflict' }),
    })
    renderWithProviders(<LocationsAdmin />, { fetchFn: fake.fetch })
    // Act — add a floor whose name collides with an existing sibling.
    await user.click(await screen.findByLabelText('Add inside HQ'))
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Floor 2')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    // Assert — the error shows inline beside the field, and the modal stays open.
    expect(await screen.findByText(strings.locations.duplicateName)).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    // Typing again retracts the stale error.
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'x')
    expect(screen.queryByText(strings.locations.duplicateName)).not.toBeInTheDocument()
  })

  it('shows a friendly inline error when the server rejects a duplicate sibling name on rename', async () => {
    // Arrange
    const user = userEvent.setup()
    const fake = createFakeFetch({
      'GET /api/v1/locations': [building, floor],
      [`PATCH /api/v1/locations/${floor.id}`]: () =>
        problemResponse(409, { type: 'urn:rivian-kanban:problem:conflict', title: 'Conflict' }),
    })
    renderWithProviders(<LocationsAdmin />, { fetchFn: fake.fetch })
    // Act — rename the floor onto a name that collides with a sibling.
    await user.click(await screen.findByLabelText('Rename Floor 2'))
    const nameInput = screen.getByRole('textbox', { name: 'Name' })
    await user.clear(nameInput)
    await user.type(nameInput, 'Taken')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    // Assert
    expect(await screen.findByText(strings.locations.duplicateName)).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('confirms before deleting and warns that descendants are removed', async () => {
    // Arrange
    const user = userEvent.setup()
    const fake = createFakeFetch({
      'GET /api/v1/locations': [building, floor],
      [`DELETE /api/v1/locations/${building.id}`]: {},
    })
    renderWithProviders(<LocationsAdmin />, { fetchFn: fake.fetch })
    // Act — opening the delete affordance shows a confirm dialog, no request yet.
    await user.click(await screen.findByLabelText('Delete HQ'))
    const dialog = await screen.findByRole('dialog')
    // Assert — the dialog names the target and warns about descendants.
    expect(dialog).toHaveTextContent('Delete “HQ”?')
    expect(dialog).toHaveTextContent(/floors and rooms/i)
    expect(fake.calls.some((c) => c.method === 'DELETE')).toBe(false)
    // Act — confirming issues the DELETE.
    await user.click(screen.getByRole('button', { name: 'Delete location' }))
    // Assert
    expect(fake.calls.some((c) => c.method === 'DELETE')).toBe(true)
  })
})
