import { type Card } from '@rivian-kanban/core'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createFakeFetch } from '../test/fake-fetch.ts'
import { makeCard } from '../test/fixtures.ts'
import { renderWithProviders } from '../test/render.tsx'
import { useCardAction } from './board.ts'

/** A minimal harness that fires a cancel through the real `useCardAction` hook. */
function CancelTrigger({ card }: { card: Pick<Card, 'id' | 'version'> }) {
  const action = useCardAction()
  return (
    <button
      type="button"
      onClick={() => {
        action.mutate({ card, action: 'cancel', body: { resolution: 'duplicate' } })
      }}
    >
      Cancel it
    </button>
  )
}

describe('undoable card-action toast', () => {
  it('offers Undo after a cancel, and clicking it reopens the card', async () => {
    // Arrange
    const user = userEvent.setup()
    const card = makeCard('in_progress', { version: 2 })
    const fake = createFakeFetch({
      [`POST /api/v1/cards/${String(card.id)}/cancel`]: {
        ...card,
        version: 3,
        resolution: 'duplicate',
      },
      [`POST /api/v1/cards/${String(card.id)}/reopen`]: { ...card, version: 4, resolution: null },
    })
    renderWithProviders(<CancelTrigger card={card} />, { fetchFn: fake.fetch })

    // Act — cancel, then click the Undo the toast offers.
    await user.click(screen.getByRole('button', { name: 'Cancel it' }))
    await user.click(await screen.findByRole('button', { name: 'Undo' }))

    // Assert — Undo POSTed the inverse (reopen) on the just-cancelled card.
    await waitFor(() => {
      expect(
        fake.calls.some(
          (call) =>
            call.method === 'POST' && call.url === `/api/v1/cards/${String(card.id)}/reopen`,
        ),
      ).toBe(true)
    })
  })
})
