import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createFakeFetch, type FakeRouteResult } from '../test/fake-fetch.ts'
import {
  fixtureAdmin,
  fixturePickerUsers,
  makeBoard,
  makeCard,
  permissivePolicy,
  policyRecordOf,
  uid,
} from '../test/fixtures.ts'
import { renderWithProviders } from '../test/render.tsx'
import { NewCardButton } from './NewCardButton.tsx'

/** The card body's assignee picker hits `/users/search` while the form renders. */
function userSearchHandler(_init: RequestInit | undefined, url: string): FakeRouteResult {
  const query = new URLSearchParams(url.split('?')[1] ?? '')
  const q = (query.get('q') ?? '').toLowerCase()
  return fixturePickerUsers.filter((user) => user.displayName.toLowerCase().includes(q))
}

const created = makeCard('intake', { title: 'Broken door', version: 1 })

function buttonFake(extra: Record<string, unknown> = {}) {
  return createFakeFetch({
    'POST /api/v1/cards': created,
    'GET /api/v1/board': makeBoard({ intake: [created] }),
    'GET /api/v1/policy': policyRecordOf(permissivePolicy),
    'GET /api/v1/locations': [],
    'GET /api/v1/tags': [],
    'GET /api/v1/users/search': userSearchHandler,
    ...extra,
  })
}

describe('NewCardButton', () => {
  it('opens an empty modal and POSTs nothing until Create', async () => {
    // Arrange — the flakiness the PO reported: a draft appearing on open. It must
    // not — opening only shows an empty form.
    const user = userEvent.setup()
    const fake = buttonFake()
    renderWithProviders(<NewCardButton />, { fetchFn: fake.fetch })
    // Act
    await user.click(screen.getByRole('button', { name: 'New work order' }))
    // Assert — the form opened empty and nothing was POSTed.
    expect(await screen.findByRole('dialog', { name: 'New work order' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /Title/ })).toHaveValue('')
    expect(fake.calls.some((call) => call.method === 'POST')).toBe(false)
  })

  it('POSTs the fields only when Create is clicked, then closes', async () => {
    // Arrange
    const user = userEvent.setup()
    const fake = buttonFake()
    renderWithProviders(<NewCardButton />, { fetchFn: fake.fetch })
    await user.click(screen.getByRole('button', { name: 'New work order' }))
    await screen.findByRole('dialog', { name: 'New work order' })
    // Act
    await user.type(screen.getByRole('textbox', { name: /Title/ }), 'Broken door')
    await user.click(screen.getByRole('button', { name: 'Create' }))
    // Assert — one POST with the fields + defaults, then the modal closes.
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'New work order' })).not.toBeInTheDocument()
    })
    expect(fake.lastBody('POST', '/api/v1/cards')).toEqual({
      title: 'Broken door',
      description: '',
      priority: 'P2',
      tags: [],
    })
  })

  it('uploads a staged attachment to the created work order after the POST', async () => {
    // Arrange
    const user = userEvent.setup()
    const fake = buttonFake({
      [`POST /api/v1/cards/${String(created.id)}/attachments`]: {
        id: uid(300),
        cardId: created.id,
        filename: 'photo.png',
        mime: 'image/png',
        bytes: 1024,
        sha256: 'a'.repeat(64),
        storageKey: uid(301),
        uploadedBy: fixtureAdmin.id,
        createdAt: '2026-07-01T10:00:00.000Z',
        deletedAt: null,
      },
    })
    renderWithProviders(<NewCardButton />, { fetchFn: fake.fetch })
    await user.click(screen.getByRole('button', { name: 'New work order' }))
    await screen.findByRole('dialog', { name: 'New work order' })
    // Act — stage a file, fill the title, then Create.
    const file = new File(['x'], 'photo.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText<HTMLInputElement>('Browse files'), file)
    await user.type(screen.getByRole('textbox', { name: /Title/ }), 'Broken door')
    await user.click(screen.getByRole('button', { name: 'Create' }))
    // Assert — the file uploaded to the freshly created work order's id.
    await waitFor(() => {
      expect(
        fake.calls.some(
          (call) =>
            call.method === 'POST' &&
            call.url === `/api/v1/cards/${String(created.id)}/attachments`,
        ),
      ).toBe(true)
    })
  })
})
