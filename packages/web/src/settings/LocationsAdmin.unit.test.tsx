import { type Location } from '@rivian-kanban/core'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createFakeFetch } from '../test/fake-fetch.ts'
import { uid } from '../test/fixtures.ts'
import { renderWithProviders } from '../test/render.tsx'
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

  it('renames and deletes locations through their node actions', async () => {
    // Arrange
    const user = userEvent.setup()
    const fake = createFakeFetch({
      'GET /api/v1/locations': [building],
      [`PATCH /api/v1/locations/${building.id}`]: { ...building, name: 'HQ West' },
      [`DELETE /api/v1/locations/${building.id}`]: {},
    })
    renderWithProviders(<LocationsAdmin />, { fetchFn: fake.fetch })
    // Act
    await user.click(await screen.findByLabelText('Rename HQ'))
    const nameInput = screen.getByRole('textbox', { name: 'Name' })
    await user.clear(nameInput)
    await user.type(nameInput, 'HQ West')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await user.click(await screen.findByLabelText('Delete HQ'))
    // Assert
    expect(fake.lastBody('PATCH', `/api/v1/locations/${building.id}`)).toEqual({ name: 'HQ West' })
    expect(fake.calls.some((c) => c.method === 'DELETE')).toBe(true)
  })
})
