import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createFakeFetch, problemResponse, type FakeFetch } from '../test/fake-fetch.ts'
import {
  fixtureAdmin,
  fixturePickerUsers,
  fixtureTech,
  makeBoard,
  makeCard,
  makeComment,
  makeStatusChangedEvent,
  permissivePolicy,
  policyRecordOf,
  uid,
} from '../test/fixtures.ts'
import { renderApp } from '../test/render.tsx'

const card = makeCard('ready', { title: 'Fix pump', description: 'It leaks', version: 4 })

function panelApp(extra: Record<string, unknown> = {}): FakeFetch {
  return createFakeFetch({
    'GET /api/v1/auth/me': fixtureAdmin,
    'GET /api/v1/board': makeBoard({ ready: [card] }),
    'GET /api/v1/policy': policyRecordOf(permissivePolicy),
    'GET /api/v1/users': fixturePickerUsers,
    'GET /api/v1/locations': [],
    'GET /api/v1/tags': [{ id: uid(110), name: 'plumbing' }],
    [`GET /api/v1/cards/${card.id}`]: {
      card: card,
      tags: [],
      location: null,
      attachments: [],
    },
    [`GET /api/v1/cards/${card.id}/comments`]: [],
    [`GET /api/v1/cards/${card.id}/events`]: { items: [], nextCursor: null },
    ...extra,
  })
}

describe('CardPanel', () => {
  it('saves edited fields with If-Match from the card version', async () => {
    // Arrange
    const user = userEvent.setup()
    const fake = panelApp({ [`PATCH /api/v1/cards/${card.id}`]: card })
    renderApp({ fetchFn: fake.fetch, route: `/cards/${card.id}` })
    // Act
    const title = await screen.findByRole('textbox', { name: /Title/ })
    await user.clear(title)
    await user.type(title, 'Replace pump seal')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    // Assert
    expect(fake.lastBody('PATCH', `/api/v1/cards/${card.id}`)).toEqual({
      title: 'Replace pump seal',
    })
    const patch = fake.calls.find((c) => c.method === 'PATCH')
    expect(new Headers(patch?.init?.headers).get('If-Match')).toBe('"4"')
  })

  it('posts, edits, and deletes comments in the thread tab', async () => {
    // Arrange
    const user = userEvent.setup()
    const existing = makeComment({
      id: uid(111),
      cardId: card.id,
      authorId: fixtureAdmin.id,
      body: 'Old note',
    })
    const fake = panelApp({
      [`GET /api/v1/cards/${card.id}/comments`]: [existing],
      [`POST /api/v1/cards/${card.id}/comments`]: makeComment({
        id: uid(112),
        cardId: card.id,
        body: 'New note',
      }),
      [`PATCH /api/v1/comments/${existing.id}`]: { ...existing, body: 'Edited note' },
      [`DELETE /api/v1/comments/${existing.id}`]: {},
    })
    renderApp({ fetchFn: fake.fetch, route: `/cards/${card.id}` })
    await screen.findByRole('textbox', { name: /Title/ })
    // Act
    await user.click(screen.getByRole('tab', { name: 'Comments' }))
    await user.type(await screen.findByRole('textbox', { name: 'Add a comment' }), 'New note')
    await user.click(screen.getByRole('button', { name: 'Comment' }))
    await user.click(await screen.findByRole('button', { name: 'Edit comment' }))
    const editBox = screen.getByRole('textbox', { name: 'Edit comment' })
    await user.clear(editBox)
    await user.type(editBox, 'Edited note')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await user.click(await screen.findByRole('button', { name: 'Delete comment' }))
    // Assert
    expect(fake.lastBody('POST', `/api/v1/cards/${card.id}/comments`)).toEqual({
      body: 'New note',
    })
    expect(fake.lastBody('PATCH', `/api/v1/comments/${existing.id}`)).toEqual({
      body: 'Edited note',
    })
    expect(fake.calls.some((c) => c.method === 'DELETE')).toBe(true)
  })

  it('renders the placeholder for a soft-deleted comment served with a blanked body', async () => {
    // Arrange — the REST contract blanks deleted bodies (rest-api.md#comments).
    const user = userEvent.setup()
    const deleted = makeComment({
      id: uid(113),
      cardId: card.id,
      body: '',
      deletedAt: '2026-07-02T10:00:00.000Z',
    })
    const reply = makeComment({
      id: uid(114),
      cardId: card.id,
      parentCommentId: deleted.id,
      body: 'Reply kept for context',
    })
    const fake = panelApp({
      [`GET /api/v1/cards/${card.id}/comments`]: [deleted, reply],
    })
    renderApp({ fetchFn: fake.fetch, route: `/cards/${card.id}` })
    await screen.findByRole('textbox', { name: /Title/ })
    // Act
    await user.click(screen.getByRole('tab', { name: 'Comments' }))
    // Assert
    expect(await screen.findByText('(deleted)')).toBeInTheDocument()
    expect(screen.getByText('Reply kept for context')).toBeInTheDocument()
  })

  it('renders history lines and loads more pages by cursor', async () => {
    // Arrange
    const user = userEvent.setup()
    const first = makeStatusChangedEvent(card, 21, 'intake', 'waiting_approval')
    const second = makeStatusChangedEvent(card, 22, 'waiting_approval', 'ready')
    let eventsCall = 0
    const fake = panelApp({
      [`GET /api/v1/cards/${card.id}/events`]: () => {
        eventsCall += 1
        return eventsCall === 1
          ? { items: [first], nextCursor: 'cursor-2' }
          : { items: [second], nextCursor: null }
      },
    })
    renderApp({ fetchFn: fake.fetch, route: `/cards/${card.id}` })
    await screen.findByRole('textbox', { name: /Title/ })
    // Act
    await user.click(screen.getByRole('tab', { name: 'History' }))
    await user.click(await screen.findByRole('button', { name: 'Load more' }))
    // Assert
    expect(
      await screen.findByText(/moved the card from Waiting for Approval to Ready/),
    ).toBeInTheDocument()
    const secondCall = fake.calls.filter((c) => c.url.includes('/events')).at(-1)
    expect(secondCall?.url).toContain('cursor=cursor-2')
  })

  it('renders an archived card read-only with a working Reopen action', async () => {
    // Arrange
    const archived = makeCard('done', {
      title: 'Old job',
      resolution: 'completed',
      archivedAt: '2026-04-01T10:00:00.000Z',
      version: 6,
    })
    const user = userEvent.setup()
    const fake = createFakeFetch({
      'GET /api/v1/auth/me': fixtureAdmin,
      'GET /api/v1/board': makeBoard({}),
      'GET /api/v1/policy': policyRecordOf(permissivePolicy),
      'GET /api/v1/users': fixturePickerUsers,
      'GET /api/v1/locations': [],
      'GET /api/v1/tags': [],
      [`GET /api/v1/cards/${archived.id}`]: {
        card: archived,
        tags: [],
        location: null,
        attachments: [],
      },
      [`GET /api/v1/cards/${archived.id}/comments`]: [],
      [`GET /api/v1/cards/${archived.id}/events`]: { items: [], nextCursor: null },
      [`POST /api/v1/cards/${archived.id}/reopen`]: archived,
    })
    renderApp({ fetchFn: fake.fetch, route: `/cards/${archived.id}` })
    // Act
    await screen.findByText('This card is archived — reopen it to make changes.')
    await user.click(screen.getByRole('button', { name: 'Reopen' }))
    // Assert — fields read-only, no dropzone, and reopen hit the API
    expect(screen.getByRole('textbox', { name: /Title/ })).toBeDisabled()
    expect(screen.queryByRole('group', { name: 'Attachment dropzone' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
    const reopen = fake.calls.find((c) => c.url.includes('/reopen'))
    expect(new Headers(reopen?.init?.headers).get('If-Match')).toBe('"6"')
  })

  it('surfaces a failed comment post as a toast and keeps the draft', async () => {
    // Arrange
    const user = userEvent.setup()
    const fake = panelApp({
      [`POST /api/v1/cards/${card.id}/comments`]: () =>
        problemResponse(409, { title: 'Card is archived' }),
    })
    renderApp({ fetchFn: fake.fetch, route: `/cards/${card.id}` })
    await screen.findByRole('textbox', { name: /Title/ })
    // Act
    await user.click(screen.getByRole('tab', { name: 'Comments' }))
    await user.type(await screen.findByRole('textbox', { name: 'Add a comment' }), 'Lost words?')
    await user.click(screen.getByRole('button', { name: 'Comment' }))
    // Assert — the problem title is toasted and the composer keeps the text
    expect(await screen.findByText('Card is archived')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Add a comment' })).toHaveValue('Lost words?')
  })

  it("hides delete on others' attachments when the policy gates it below the role", async () => {
    // Arrange — deleteOthersAttachments gated to admin; viewer is a technician
    const theirs = {
      id: uid(115),
      cardId: card.id,
      filename: 'their-photo.png',
      mime: 'image/png',
      bytes: 9,
      sha256: 'c'.repeat(64),
      storageKey: uid(116),
      uploadedBy: fixtureAdmin.id,
      createdAt: '2026-07-01T10:00:00.000Z',
      deletedAt: null,
    }
    const fake = panelApp({
      'GET /api/v1/auth/me': fixtureTech,
      'GET /api/v1/policy': policyRecordOf({
        ...permissivePolicy,
        actionGates: { deleteOthersAttachments: 'admin' as const },
      }),
      [`GET /api/v1/cards/${card.id}`]: {
        card: card,
        tags: [],
        location: null,
        attachments: [theirs],
      },
    })
    // Act
    renderApp({ fetchFn: fake.fetch, route: `/cards/${card.id}` })
    // Assert
    expect(await screen.findByRole('img', { name: 'their-photo.png' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete their-photo.png' })).not.toBeInTheDocument()
  })

  it('uploads an attachment as multipart with a single `file` part', async () => {
    // Arrange
    const user = userEvent.setup()
    const stored = {
      id: uid(113),
      cardId: card.id,
      filename: 'after.png',
      mime: 'image/png',
      bytes: 9,
      sha256: 'b'.repeat(64),
      storageKey: uid(114),
      uploadedBy: fixtureAdmin.id,
      createdAt: '2026-07-01T10:00:00.000Z',
      deletedAt: null,
    }
    const fake = panelApp({ [`POST /api/v1/cards/${card.id}/attachments`]: stored })
    renderApp({ fetchFn: fake.fetch, route: `/cards/${card.id}` })
    await screen.findByRole('textbox', { name: /Title/ })
    // Act
    const file = new File(['png-bytes'], 'after.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText<HTMLInputElement>('Browse files'), file)
    // Assert
    const upload = fake.calls.find((c) => c.url.endsWith('/attachments'))
    const body = upload?.init?.body
    expect(body).toBeInstanceOf(FormData)
    expect((body as FormData).get('file')).toBeInstanceOf(File)
  })

  it('surfaces an oversized upload (413) as a visible problem toast', async () => {
    // Arrange
    const user = userEvent.setup()
    const fake = panelApp({
      [`POST /api/v1/cards/${card.id}/attachments`]: () =>
        problemResponse(413, { title: 'Upload too large' }),
    })
    renderApp({ fetchFn: fake.fetch, route: `/cards/${card.id}` })
    await screen.findByRole('textbox', { name: /Title/ })
    // Act
    const file = new File(['png-bytes'], 'huge.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText<HTMLInputElement>('Browse files'), file)
    // Assert
    expect(await screen.findByText('Upload too large')).toBeInTheDocument()
  })
})
