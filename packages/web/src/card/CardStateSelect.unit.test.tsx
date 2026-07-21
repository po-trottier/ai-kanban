import { type Card } from '@rivian-kanban/core'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createFakeFetch, jsonResponse } from '../test/fake-fetch.ts'
import { makeBoard, makeCard, nth, permissivePolicy } from '../test/fixtures.ts'
import { type BoardResponse } from '../api/schemas.ts'
import { renderWithProviders } from '../test/render.tsx'
import dayjs from '../lib/dayjs.ts'
import { CardStateSelect } from './CardStateSelect.tsx'

// The resume-date picker's `minDate` is "today" in the viewer's zone (the LA
// fixture admin), so pick today DYNAMICALLY — a hard-coded calendar date
// silently becomes unselectable (past `minDate`) once the clock rolls past it.
const RESUME_TZ = 'America/Los_Angeles'
const resumeTodayLabel = dayjs().tz(RESUME_TZ).format('D MMMM YYYY')
const resumeTodayIso = dayjs().tz(RESUME_TZ).format('YYYY-MM-DD')

function renderStateSelect(
  card: Card,
  board: BoardResponse,
  routes: Record<string, unknown> = {},
  disabled = false,
) {
  const fake = createFakeFetch(routes)
  renderWithProviders(
    <CardStateSelect
      card={card}
      board={board}
      policy={permissivePolicy}
      role="admin"
      disabled={disabled}
    />,
    { fetchFn: fake.fetch },
  )
  return { fake }
}

describe('CardStateSelect', () => {
  it('shows the card’s current lane as the selected state', () => {
    // Arrange
    const card = makeCard('intake')
    const board = makeBoard({ intake: [card] })
    // Act
    renderStateSelect(card, board)
    // Assert — the dropdown reads the card's lane (Intake), not a placeholder.
    expect(screen.getByRole('combobox', { name: 'State' })).toHaveValue('Intake')
  })

  it('moves the card to the BOTTOM of the chosen lane', async () => {
    // Arrange — Ready already holds one card, so "bottom" lands after it
    // (prevCardId = that card, nextCardId = null).
    const user = userEvent.setup()
    const card = makeCard('intake', { version: 3 })
    const readyCard = makeCard('ready')
    const board = makeBoard({ intake: [card], ready: [readyCard] })
    const { fake } = renderStateSelect(card, board, {
      [`POST /api/v1/cards/${String(card.id)}/move`]: jsonResponse(card),
    })
    // Act — pick "Ready" from the State dropdown.
    await user.click(screen.getByRole('combobox', { name: 'State' }))
    await user.click(await screen.findByRole('option', { name: 'Ready' }))
    // Assert — the move posts the bottom-of-Ready neighbors and the If-Match version.
    expect(fake.lastBody('POST', `/api/v1/cards/${String(card.id)}/move`)).toEqual({
      toLane: 'ready',
      prevCardId: readyCard.id,
      nextCardId: null,
    })
    const call = fake.calls.find((c) => c.url.includes('/move'))
    expect(new Headers(call?.init?.headers).get('If-Match')).toBe('"3"')
  })

  it('routes a move into the waiting lane through the reason + date modal first', async () => {
    // Arrange
    const user = userEvent.setup()
    const card = makeCard('in_progress', { version: 2 })
    const board = makeBoard({ in_progress: [card] })
    const { fake } = renderStateSelect(card, board, {
      [`POST /api/v1/cards/${String(card.id)}/move`]: jsonResponse(card),
    })
    // Act — choosing the waiting lane opens the modal and posts NOTHING yet…
    await user.click(screen.getByRole('combobox', { name: 'State' }))
    await user.click(await screen.findByRole('option', { name: 'Waiting on Parts / Vendor' }))
    expect(fake.calls.some((c) => c.url.includes('/move'))).toBe(false)
    // …fill the required reason + resume date, then confirm.
    await user.click(await screen.findByRole('combobox', { name: 'Waiting reason' }))
    await user.click(screen.getByRole('option', { name: 'Vendor' }))
    await user.click(screen.getByRole('button', { name: 'Expected resume date' }))
    await user.click(nth(screen.getAllByRole('button', { name: resumeTodayLabel }), 0))
    await user.click(screen.getByRole('button', { name: 'Move work order' }))
    // Assert — the move now carries the waiting reason + resume date.
    expect(fake.lastBody('POST', `/api/v1/cards/${String(card.id)}/move`)).toMatchObject({
      toLane: 'waiting_parts_vendor',
      waitingReason: 'vendor',
      expectedResumeAt: resumeTodayIso,
    })
  })

  it('is read-only when disabled (an archived card)', () => {
    // Arrange
    const card = makeCard('done')
    const board = makeBoard({ done: [card] })
    // Act
    renderStateSelect(card, board, {}, true)
    // Assert — no state change is possible until the card is reopened.
    expect(screen.getByRole('combobox', { name: 'State' })).toBeDisabled()
  })
})
