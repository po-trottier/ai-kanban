import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createFakeFetch } from '../test/fake-fetch.ts'
import { coreCard, fixturePickerUsers, makeCard } from '../test/fixtures.ts'
import { renderWithProviders } from '../test/render.tsx'
import { NewCardButton } from './NewCardButton.tsx'

describe('NewCardButton', () => {
  it('creates a card through POST /cards and closes the modal', async () => {
    // Arrange
    const user = userEvent.setup()
    const fake = createFakeFetch({
      'GET /api/v1/users': fixturePickerUsers,
      'GET /api/v1/locations': [],
      'GET /api/v1/tags': [],
      'POST /api/v1/cards': coreCard(makeCard('intake', { title: 'Broken door' })),
    })
    renderWithProviders(<NewCardButton />, { fetchFn: fake.fetch })
    // Act
    await user.click(screen.getByRole('button', { name: 'New card' }))
    await user.type(await screen.findByRole('textbox', { name: /Title/ }), 'Broken door')
    await user.click(screen.getByRole('button', { name: 'Create' }))
    // Assert
    expect(fake.lastBody('POST', '/api/v1/cards')).toEqual({
      title: 'Broken door',
      description: '',
      priority: 'P2',
      tags: [],
    })
    expect(await screen.findByText('Card created in Intake')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /Title/ })).not.toBeInTheDocument()
  })

  it('closes the modal without creating when cancelled', async () => {
    // Arrange
    const user = userEvent.setup()
    const fake = createFakeFetch({
      'GET /api/v1/users': fixturePickerUsers,
      'GET /api/v1/locations': [],
      'GET /api/v1/tags': [],
    })
    renderWithProviders(<NewCardButton />, { fetchFn: fake.fetch })
    // Act
    await user.click(screen.getByRole('button', { name: 'New card' }))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    // Assert
    expect(screen.queryByRole('textbox', { name: /Title/ })).not.toBeInTheDocument()
    expect(fake.calls.every((call) => call.method === 'GET')).toBe(true)
  })
})
