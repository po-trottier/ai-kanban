import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createFakeFetch, type FakeRouteResult } from '../test/fake-fetch.ts'
import {
  fixturePickerUsers,
  makeBoard,
  makeCard,
  permissivePolicy,
  policyRecordOf,
} from '../test/fixtures.ts'
import { renderWithProviders } from '../test/render.tsx'
import { CreateCardModal } from './CreateCardModal.tsx'

/** Assignee search (`?q=`) + read-only reporter resolve (`?ids=`) both hit /users/search. */
function userSearchHandler(_init: RequestInit | undefined, url: string): FakeRouteResult {
  const query = new URLSearchParams(url.split('?')[1] ?? '')
  const ids = query.get('ids')
  if (ids !== null) {
    const wanted = new Set(ids.split(','))
    return fixturePickerUsers.filter((user) => wanted.has(user.id))
  }
  const q = (query.get('q') ?? '').toLowerCase()
  return fixturePickerUsers.filter((user) => user.displayName.toLowerCase().includes(q))
}

const draft = makeCard('intake', { title: 'Untitled', version: 1 })

function modalFake(extra: Record<string, unknown> = {}) {
  return createFakeFetch({
    'GET /api/v1/board': makeBoard({ intake: [draft] }),
    'GET /api/v1/policy': policyRecordOf(permissivePolicy),
    'GET /api/v1/locations': [],
    'GET /api/v1/tags': [],
    'GET /api/v1/users/search': userSearchHandler,
    [`GET /api/v1/cards/${String(draft.id)}`]: {
      card: draft,
      tags: [],
      location: null,
      attachments: [],
    },
    [`GET /api/v1/cards/${String(draft.id)}/relations`]: [],
    ...extra,
  })
}

describe('CreateCardModal', () => {
  it('renders the shared card body with a Cancel/Create footer, no Save button, no State', async () => {
    // Arrange
    const fake = modalFake()
    // Act
    renderWithProviders(<CreateCardModal card={draft} onClose={() => undefined} />, {
      fetchFn: fake.fetch,
    })
    // Assert — the SAME body (title field, relations, attachments) but auto-saving:
    // no explicit Save button and no State picker (a new card is always Intake);
    // a Cancel/Create footer instead, inside a modal.
    await screen.findByRole('textbox', { name: /Title/ })
    expect(screen.getByRole('dialog', { name: 'New card' })).toBeInTheDocument()
    expect(screen.getByText('Relations')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'State' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument()
  })

  it('cancels the draft via DELETE /cards/:id and closes', async () => {
    // Arrange
    const user = userEvent.setup()
    let closed = false
    const fake = modalFake({
      [`DELETE /api/v1/cards/${String(draft.id)}`]: new Response(null, { status: 204 }),
    })
    renderWithProviders(
      <CreateCardModal
        card={draft}
        onClose={() => {
          closed = true
        }}
      />,
      { fetchFn: fake.fetch },
    )
    await screen.findByRole('textbox', { name: /Title/ })
    // Act
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    // Assert — a DELETE hit the draft, then onClose ran.
    await waitFor(() => {
      expect(
        fake.calls.some(
          (call) =>
            call.method === 'DELETE' &&
            (call.url.split('?')[0] ?? call.url) === `/api/v1/cards/${String(draft.id)}`,
        ),
      ).toBe(true)
    })
    await waitFor(() => {
      expect(closed).toBe(true)
    })
  })

  it('keeps the card and closes on Create (no delete) when nothing was edited', async () => {
    // Arrange
    const user = userEvent.setup()
    let closed = false
    const fake = modalFake()
    renderWithProviders(
      <CreateCardModal
        card={draft}
        onClose={() => {
          closed = true
        }}
      />,
      { fetchFn: fake.fetch },
    )
    await screen.findByRole('textbox', { name: /Title/ })
    // Act — Create submits the (unchanged) form; nothing to save, so it just closes.
    await user.click(screen.getByRole('button', { name: 'Create' }))
    // Assert — closed, and the draft is never deleted or patched.
    await waitFor(() => {
      expect(closed).toBe(true)
    })
    expect(fake.calls.every((call) => call.method !== 'DELETE')).toBe(true)
  })
})
