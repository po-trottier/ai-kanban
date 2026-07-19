import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createFakeFetch } from '../test/fake-fetch.ts'
import { makeCard } from '../test/fixtures.ts'
import { renderWithProviders } from '../test/render.tsx'
import { NewCardButton } from './NewCardButton.tsx'

describe('NewCardButton', () => {
  it('creates a placeholder draft in Intake through POST /cards', async () => {
    // Arrange — create-then-edit (docs/architecture/frontend.md): the button
    // creates a real draft immediately (no modal) so the same detail panel can
    // open on it in "create view", instead of a parallel create form.
    const user = userEvent.setup()
    const fake = createFakeFetch({
      'POST /api/v1/cards': makeCard('intake', { title: 'Untitled' }),
    })
    renderWithProviders(<NewCardButton />, { fetchFn: fake.fetch })
    // Act
    await user.click(screen.getByRole('button', { name: 'New card' }))
    // Assert — the draft posts a NON-EMPTY placeholder title (core requires one)
    // plus the schema defaults, and the "created in Intake" toast confirms it.
    await screen.findByText('Card created in Intake')
    expect(fake.lastBody('POST', '/api/v1/cards')).toEqual({
      title: 'Untitled',
      description: '',
      priority: 'P2',
      tags: [],
    })
  })
})
