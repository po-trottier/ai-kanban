import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createFakeFetch, jsonResponse } from '../test/fake-fetch.ts'
import { renderWithProviders } from '../test/render.tsx'
import { WatchToggle } from './CardPanel.tsx'

describe('WatchToggle', () => {
  it('shows "watching" and unwatches on click (DELETE)', async () => {
    // Arrange — the card is already watched.
    const user = userEvent.setup()
    const fake = createFakeFetch({
      'GET /api/v1/cards/5/watch': { watching: true },
      'DELETE /api/v1/cards/5/watch': jsonResponse({ watching: false }),
    })
    renderWithProviders(<WatchToggle cardId="5" />, { fetchFn: fake.fetch })
    // Act — the control offers to STOP watching…
    const button = await screen.findByRole('button', { name: 'Stop watching this card' })
    await user.click(button)
    // Assert — a DELETE fired and a toast confirms.
    expect(await screen.findByText('No longer watching this card')).toBeInTheDocument()
    expect(
      fake.calls.some((call) => call.method === 'DELETE' && call.url === '/api/v1/cards/5/watch'),
    ).toBe(true)
  })

  it('shows "not watching" and watches on click (PUT)', async () => {
    // Arrange — the card is not watched.
    const user = userEvent.setup()
    const fake = createFakeFetch({
      'GET /api/v1/cards/5/watch': { watching: false },
      'PUT /api/v1/cards/5/watch': jsonResponse({ watching: true }),
    })
    renderWithProviders(<WatchToggle cardId="5" />, { fetchFn: fake.fetch })
    // Act — the control offers to START watching.
    await user.click(await screen.findByRole('button', { name: 'Watch this card' }))
    // Assert
    expect(await screen.findByText('Watching this card')).toBeInTheDocument()
    expect(
      fake.calls.some((call) => call.method === 'PUT' && call.url === '/api/v1/cards/5/watch'),
    ).toBe(true)
  })
})
