import { screen } from '@testing-library/react'
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
import { NewCardButton } from './NewCardButton.tsx'

/** The card body's assignee/reporter pickers hit /users/search on the new draft. */
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

describe('NewCardButton', () => {
  it('creates a placeholder draft and opens the create modal on it', async () => {
    // Arrange — create-then-edit (docs/architecture/frontend.md): the button
    // creates a real draft immediately, then opens the SAME card body the detail
    // panel uses inside a modal — no bespoke create form.
    const user = userEvent.setup()
    const draft = makeCard('intake', { title: 'Untitled', version: 1 })
    const fake = createFakeFetch({
      'POST /api/v1/cards': draft,
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
    })
    renderWithProviders(<NewCardButton />, { fetchFn: fake.fetch })
    // Act
    await user.click(screen.getByRole('button', { name: 'New card' }))
    // Assert — the draft posts a NON-EMPTY placeholder title (core requires one)
    // plus the schema defaults, and the create modal opens on it.
    expect(fake.lastBody('POST', '/api/v1/cards')).toEqual({
      title: 'Untitled',
      description: '',
      priority: 'P2',
      tags: [],
    })
    expect(await screen.findByRole('dialog', { name: 'New card' })).toBeInTheDocument()
  })
})
