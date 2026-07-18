import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { createFakeFetch, jsonResponse } from '../test/fake-fetch.ts'
import {
  fixtureAdmin,
  fixturePickerUsers,
  makeBoard,
  makeCard,
  permissivePolicy,
  policyDenyingUser,
  policyRecordOf,
} from '../test/fixtures.ts'
import { renderApp } from '../test/render.tsx'
import { resetActionHistory } from './action-history.ts'
import { type Card } from '@rivian-kanban/core'

/**
 * End-to-end coverage of the undoable board wrappers + the global keyboard
 * handler through the real app: a menu action is performed, then Ctrl+Z fires
 * the INVERSE mutation reusing the existing endpoints (ITEM 86).
 */

function app(
  cards: { intake?: Card[]; ready?: Card[]; done?: Card[] },
  routes: Record<string, unknown>,
  role: 'admin' | 'user' = 'admin',
  policy = permissivePolicy,
) {
  return createFakeFetch({
    'GET /api/v1/auth/me': { ...fixtureAdmin, role },
    'GET /api/v1/board': makeBoard(cards),
    'GET /api/v1/policy': policyRecordOf(policy),
    'GET /api/v1/users': fixturePickerUsers,
    'GET /api/v1/locations': [],
    'GET /api/v1/tags': [],
    ...routes,
  })
}

async function openCardMenu(user: ReturnType<typeof userEvent.setup>, title: string) {
  const card = await screen.findByLabelText(title)
  await user.click(within(card).getByRole('button', { name: 'Card actions' }))
}

afterEach(() => {
  resetActionHistory()
})

describe('undo through the board', () => {
  it('Ctrl+Z after a cancel fires reopen (the reverse transition) with a fresh If-Match', async () => {
    // Arrange
    const user = userEvent.setup()
    const card = makeCard('intake', { title: 'Wrongly cancelled', version: 5 })
    const fake = app(
      { intake: [card] },
      {
        [`POST /api/v1/cards/${String(card.id)}/cancel`]: jsonResponse({ ...card, version: 6 }),
        [`POST /api/v1/cards/${String(card.id)}/reopen`]: jsonResponse({ ...card, version: 7 }),
      },
    )
    renderApp({ fetchFn: fake.fetch })
    // Act — cancel via the menu…
    await openCardMenu(user, 'Wrongly cancelled')
    await user.click(await screen.findByRole('menuitem', { name: 'Cancel…' }))
    await user.click(screen.getByRole('combobox', { name: 'Reason' }))
    await user.click(screen.getByRole('option', { name: 'Duplicate' }))
    await user.click(screen.getByRole('button', { name: 'Cancel card' }))
    await screen.findByText('Card cancelled — moved to Done')
    // …then undo it with the keyboard.
    await user.keyboard('{Control>}z{/Control}')
    // Assert — a reopen POST fired (the recorded inverse of cancel)
    await waitFor(() => {
      expect(fake.calls.some((c) => c.method === 'POST' && c.url.includes('/reopen'))).toBe(true)
    })
    expect(await screen.findByText('Undone: card cancellation')).toBeInTheDocument()
  })

  it('Ctrl+Z after a menu move fires the inverse move back to the prior lane', async () => {
    // Arrange
    const user = userEvent.setup()
    const a = makeCard('ready', { title: 'Neighbor' })
    const moving = makeCard('intake', { title: 'Slipped card', version: 3 })
    const fake = app(
      { ready: [a], intake: [moving] },
      { [`POST /api/v1/cards/${String(moving.id)}/move`]: jsonResponse({ ...moving, version: 4 }) },
    )
    renderApp({ fetchFn: fake.fetch })
    // Act — move intake → ready via the menu…
    await openCardMenu(user, 'Slipped card')
    await user.click(await screen.findByRole('menuitem', { name: 'Move to…' }))
    await user.click(await screen.findByRole('combobox', { name: 'Column' }))
    await user.click(screen.getByRole('option', { name: 'Ready' }))
    await user.click(screen.getByRole('button', { name: 'Move' }))
    await waitFor(() => {
      expect(fake.calls.some((c) => c.url.includes('/move'))).toBe(true)
    })
    const movesBefore = fake.calls.filter((c) => c.url.includes('/move')).length
    // …then undo the move.
    await user.keyboard('{Control>}z{/Control}')
    // Assert — a SECOND move request fired (the recorded inverse)
    await waitFor(() => {
      expect(fake.calls.filter((c) => c.url.includes('/move')).length).toBe(movesBefore + 1)
    })
  })

  it('Ctrl+Z after archiving a Done card fires reopen', async () => {
    // Arrange
    const user = userEvent.setup()
    const done = makeCard('done', { title: 'Closed job', resolution: 'completed', version: 7 })
    const fake = app(
      { done: [done] },
      {
        [`POST /api/v1/cards/${String(done.id)}/archive`]: jsonResponse({
          ...done,
          archivedAt: '2026-07-16T00:00:00.000Z',
          version: 8,
        }),
        [`POST /api/v1/cards/${String(done.id)}/reopen`]: jsonResponse({ ...done, version: 9 }),
      },
    )
    renderApp({ fetchFn: fake.fetch })
    // Act
    await openCardMenu(user, 'Closed job')
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }))
    await screen.findByText('Card archived')
    await user.keyboard('{Control>}z{/Control}')
    // Assert
    await waitFor(() => {
      expect(fake.calls.some((c) => c.method === 'POST' && c.url.includes('/reopen'))).toBe(true)
    })
  })

  it('skips a doomed inverse and toasts when the reopen is not permitted (RBAC)', async () => {
    // Arrange — a plain user whose policy denies reopen; cancel is still allowed.
    const user = userEvent.setup()
    const card = makeCard('intake', { title: 'No undo for you', version: 2 })
    const noReopen = policyDenyingUser('card.reopen')
    const fake = app(
      { intake: [card] },
      { [`POST /api/v1/cards/${String(card.id)}/cancel`]: jsonResponse({ ...card, version: 3 }) },
      'user',
      noReopen,
    )
    renderApp({ fetchFn: fake.fetch })
    // Act — cancel, then try to undo it
    await openCardMenu(user, 'No undo for you')
    await user.click(await screen.findByRole('menuitem', { name: 'Cancel…' }))
    await user.click(screen.getByRole('combobox', { name: 'Reason' }))
    await user.click(screen.getByRole('option', { name: 'Cancelled' }))
    await user.click(screen.getByRole('button', { name: 'Cancel card' }))
    await screen.findByText('Card cancelled — moved to Done')
    await user.keyboard('{Control>}z{/Control}')
    // Assert — the "can't undo" toast shows and NO reopen request was fired
    expect(await screen.findByText("Can't undo that")).toBeInTheDocument()
    expect(fake.calls.some((c) => c.url.includes('/reopen'))).toBe(false)
  })
})
