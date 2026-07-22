import { type NotificationView } from '@rivian-kanban/core'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'
import { createFakeFetch, jsonResponse } from '../test/fake-fetch.ts'
import { uid } from '../test/fixtures.ts'
import { renderWithProviders } from '../test/render.tsx'
import { NotificationBell } from './NotificationBell.tsx'

function notif(overrides: Partial<NotificationView> = {}): NotificationView {
  return {
    id: uid(800),
    cardId: 5,
    cardTitle: 'Leaky faucet',
    eventType: 'comment.added',
    actorName: 'Terry Tech',
    createdAt: '2026-07-18T10:00:00.000Z',
    read: false,
    ...overrides,
  }
}

/** Renders the live router URL so a click's navigation target is assertable. */
function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname + location.search}</div>
}

describe('NotificationBell', () => {
  it('shows the unread badge, lists notifications, and marks one read on open', async () => {
    // Arrange
    const user = userEvent.setup()
    const fake = createFakeFetch({
      'GET /api/v1/notifications/unread-count': { unread: 2 },
      'GET /api/v1/notifications': [
        notif({ id: uid(800) }),
        notif({
          id: uid(801),
          eventType: 'card.status_changed',
          cardTitle: 'Broken window',
          read: true,
        }),
      ],
      [`POST /api/v1/notifications/${uid(800)}/read`]: jsonResponse({ unread: 1 }),
    })
    renderWithProviders(<NotificationBell />, { fetchFn: fake.fetch })
    // Act — the bell's accessible name carries the unread count; open it.
    await user.click(await screen.findByRole('button', { name: /Notifications, 2 unread/ }))
    // The two notifications render with their human verbs.
    expect(await screen.findByText('commented on a work order')).toBeInTheDocument()
    expect(screen.getByText('moved a work order')).toBeInTheDocument()
    // Opening the unread one fires the mark-read POST.
    await user.click(
      screen.getByRole('button', { name: /Terry Tech commented on a work order.*Leaky faucet/ }),
    )
    // Assert
    expect(
      fake.calls.some(
        (call) => call.method === 'POST' && call.url === `/api/v1/notifications/${uid(800)}/read`,
      ),
    ).toBe(true)
  })

  it('deep-links a mention notification to its comment (comments tab + comment id)', async () => {
    // Arrange — a mention notification carrying the id of the comment it came from.
    const user = userEvent.setup()
    const fake = createFakeFetch({
      'GET /api/v1/notifications/unread-count': { unread: 1 },
      'GET /api/v1/notifications': [
        notif({ id: uid(800), eventType: 'mention', commentId: uid(900) }),
      ],
      [`POST /api/v1/notifications/${uid(800)}/read`]: jsonResponse({ unread: 0 }),
    })
    renderWithProviders(
      <>
        <NotificationBell />
        <LocationProbe />
      </>,
      { fetchFn: fake.fetch },
    )
    // Act — open the bell and click the mention.
    await user.click(await screen.findByRole('button', { name: /Notifications, 1 unread/ }))
    await user.click(
      screen.getByRole('button', { name: /Terry Tech mentioned you in a comment.*Leaky faucet/ }),
    )
    // Assert — navigates to the card, opens the comments tab, targets the comment.
    const url = screen.getByTestId('location').textContent
    expect(url).toContain('/cards/5')
    expect(url).toContain('tab=comments')
    expect(url).toContain(`comment=${uid(900)}`)
  })

  it('flips a read notification back to unread from its row action', async () => {
    // Arrange — a READ notification (no commentId needed).
    const user = userEvent.setup()
    const fake = createFakeFetch({
      'GET /api/v1/notifications/unread-count': { unread: 0 },
      'GET /api/v1/notifications': [notif({ id: uid(800), read: true })],
      [`POST /api/v1/notifications/${uid(800)}/unread`]: jsonResponse({ unread: 1 }),
    })
    renderWithProviders(<NotificationBell />, { fetchFn: fake.fetch })
    // Act — open the bell, click the row's "Mark as unread" (envelope).
    await user.click(await screen.findByRole('button', { name: /Notifications/ }))
    await user.click(
      await screen.findByRole('button', {
        name: 'Mark notification about Leaky faucet as unread',
      }),
    )
    // Assert — a POST to the unread route fired for that id.
    expect(
      fake.calls.some(
        (call) => call.method === 'POST' && call.url === `/api/v1/notifications/${uid(800)}/unread`,
      ),
    ).toBe(true)
  })

  it('marks the whole inbox read via the bulk action', async () => {
    // Arrange
    const user = userEvent.setup()
    const fake = createFakeFetch({
      'GET /api/v1/notifications/unread-count': { unread: 3 },
      'GET /api/v1/notifications': [notif()],
      'POST /api/v1/notifications/read-all': jsonResponse({ unread: 0 }),
    })
    renderWithProviders(<NotificationBell />, { fetchFn: fake.fetch })
    // Act
    await user.click(await screen.findByRole('button', { name: /Notifications, 3 unread/ }))
    await user.click(await screen.findByRole('button', { name: 'Mark all as read' }))
    // Assert
    expect(await screen.findByText('All notifications marked as read')).toBeInTheDocument()
    expect(
      fake.calls.some(
        (call) => call.method === 'POST' && call.url === '/api/v1/notifications/read-all',
      ),
    ).toBe(true)
  })

  it('clears one notification via its ✕ (without opening the card)', async () => {
    // Arrange
    const user = userEvent.setup()
    const fake = createFakeFetch({
      'GET /api/v1/notifications/unread-count': { unread: 1 },
      'GET /api/v1/notifications': [notif({ id: uid(800) })],
      [`DELETE /api/v1/notifications/${uid(800)}`]: jsonResponse({ unread: 0 }),
    })
    renderWithProviders(<NotificationBell />, { fetchFn: fake.fetch })
    // Act — open the bell, then click the per-row clear button.
    await user.click(await screen.findByRole('button', { name: /Notifications, 1 unread/ }))
    await user.click(
      await screen.findByRole('button', { name: 'Clear notification about Leaky faucet' }),
    )
    // Assert — a DELETE for that id fired (and it is not the mark-read route).
    expect(
      fake.calls.some(
        (call) => call.method === 'DELETE' && call.url === `/api/v1/notifications/${uid(800)}`,
      ),
    ).toBe(true)
  })

  it('clears the whole inbox via the bulk action', async () => {
    // Arrange
    const user = userEvent.setup()
    const fake = createFakeFetch({
      'GET /api/v1/notifications/unread-count': { unread: 1 },
      'GET /api/v1/notifications': [notif()],
      'DELETE /api/v1/notifications': jsonResponse({ unread: 0 }),
    })
    renderWithProviders(<NotificationBell />, { fetchFn: fake.fetch })
    // Act
    await user.click(await screen.findByRole('button', { name: /Notifications, 1 unread/ }))
    await user.click(await screen.findByRole('button', { name: 'Clear all' }))
    // Assert
    expect(await screen.findByText('All notifications cleared')).toBeInTheDocument()
    expect(
      fake.calls.some((call) => call.method === 'DELETE' && call.url === '/api/v1/notifications'),
    ).toBe(true)
  })
})
