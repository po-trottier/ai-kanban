import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createFakeFetch } from '../test/fake-fetch.ts'
import { fixtureAdmin, fixturePickerUsers, makeCard, uid } from '../test/fixtures.ts'
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
      'POST /api/v1/cards': makeCard('intake', { title: 'Broken door' }),
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

  it('uploads a picked file to the new card after creating it', async () => {
    // Arrange
    const user = userEvent.setup()
    const card = makeCard('intake', { title: 'Broken door' })
    const attachment = {
      id: uid(88),
      cardId: card.id,
      filename: 'leak.png',
      mime: 'image/png',
      bytes: 9,
      sha256: 'a'.repeat(64),
      storageKey: uid(89),
      uploadedBy: fixtureAdmin.id,
      createdAt: '2026-07-01T10:00:00.000Z',
      deletedAt: null,
    }
    const fake = createFakeFetch({
      'GET /api/v1/users': fixturePickerUsers,
      'GET /api/v1/locations': [],
      'GET /api/v1/tags': [],
      'POST /api/v1/cards': card,
      [`POST /api/v1/cards/${String(card.id)}/attachments`]: attachment,
    })
    renderWithProviders(<NewCardButton />, { fetchFn: fake.fetch })
    // Act
    await user.click(screen.getByRole('button', { name: 'New card' }))
    await user.type(await screen.findByRole('textbox', { name: /Title/ }), 'Broken door')
    await user.upload(
      screen.getByLabelText<HTMLInputElement>('Browse files'),
      new File(['png'], 'leak.png', { type: 'image/png' }),
    )
    await user.click(screen.getByRole('button', { name: 'Create' }))
    // Assert — the modal closes only after the create AND the upload complete,
    // and the attachment POST targeted the freshly created card's id.
    await waitFor(() => {
      expect(screen.queryByRole('textbox', { name: /Title/ })).not.toBeInTheDocument()
    })
    expect(
      fake.calls.some(
        (call) =>
          call.method === 'POST' && call.url === `/api/v1/cards/${String(card.id)}/attachments`,
      ),
    ).toBe(true)
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
