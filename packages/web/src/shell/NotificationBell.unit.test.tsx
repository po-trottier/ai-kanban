import { type NotificationView } from '@rivian-kanban/core'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
})
