import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import {
  createFakeFetch,
  problemResponse,
  type FakeFetch,
  type FakeRouteResult,
} from '../test/fake-fetch.ts'
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

/** The async assignee/reporter pickers hit `GET /users/search` (`?q=`/`?ids=`). */
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

function panelApp(extra: Record<string, unknown> = {}): FakeFetch {
  return createFakeFetch({
    'GET /api/v1/auth/me': fixtureAdmin,
    'GET /api/v1/board': makeBoard({ ready: [card] }),
    'GET /api/v1/policy': policyRecordOf(permissivePolicy),
    'GET /api/v1/users': fixturePickerUsers,
    'GET /api/v1/users/search': userSearchHandler,
    'GET /api/v1/locations': [],
    'GET /api/v1/tags': [{ id: uid(110), name: 'plumbing' }],
    [`GET /api/v1/cards/${String(card.id)}`]: {
      card: card,
      tags: [],
      location: null,
      attachments: [],
    },
    [`GET /api/v1/cards/${String(card.id)}/comments`]: [],
    [`GET /api/v1/cards/${String(card.id)}/events`]: { items: [], nextCursor: null },
    [`GET /api/v1/cards/${String(card.id)}/relations`]: [],
    ...extra,
  })
}

describe('CardPanel', () => {
  it('shows a skeleton body while the card detail is still loading', async () => {
    // Arrange — the board/policy resolve, but the card detail fetch hangs so
    // the panel body stays pending (its skeleton, not a blank Aside).
    const fake = panelApp()
    const fetchFn = (input: string, init?: RequestInit) =>
      input.split('?')[0] === `/api/v1/cards/${String(card.id)}`
        ? new Promise<Response>(() => undefined)
        : fake.fetch(input, init)
    // Act
    renderApp({ fetchFn, route: `/cards/${String(card.id)}` })
    // Assert — the panel opened and its body announces loading via the skeleton.
    await screen.findByRole('dialog', { name: /Card details/ })
    expect(screen.getByRole('status', { name: 'Loading…' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /Title/ })).not.toBeInTheDocument()
  })

  it('titles the drawer with the card title and its priority badge', async () => {
    // Arrange
    const fake = panelApp()
    // Act
    renderApp({ fetchFn: fake.fetch, route: `/cards/${String(card.id)}` })
    // Assert — the dialog is named by its header: the hidden panel label,
    // the card title, and the priority badge sitting inline beside it.
    const dialog = await screen.findByRole('dialog', { name: /Fix pump/ })
    expect(dialog).toHaveAccessibleName(/Card details/)
    expect(dialog).toHaveAccessibleName(new RegExp(card.priority))
  })

  it('renders non-modal on desktop so the board behind stays interactive', async () => {
    // Arrange — desktop is the default viewport in the test environment.
    const user = userEvent.setup()
    const fake = panelApp({ 'POST /api/v1/cards': makeCard('intake', { title: 'Untitled' }) })
    renderApp({ fetchFn: fake.fetch, route: `/cards/${String(card.id)}` })
    await screen.findByRole('dialog', { name: /Fix pump/ })
    // Act — operate the shell BEHIND the open panel: a modal drawer would swallow
    // this outside click instead of letting it land on the header's New card button.
    await user.click(screen.getByRole('button', { name: 'New card' }))
    // Assert — the click landed: New card created a draft (POST /cards).
    await waitFor(() => {
      expect(
        fake.calls.some(
          (call) =>
            call.method === 'POST' && (call.url.split('?')[0] ?? call.url) === '/api/v1/cards',
        ),
      ).toBe(true)
    })
  })

  it('saves edited fields with If-Match from the card version', async () => {
    // Arrange
    const user = userEvent.setup()
    const fake = panelApp({ [`PATCH /api/v1/cards/${String(card.id)}`]: card })
    renderApp({ fetchFn: fake.fetch, route: `/cards/${String(card.id)}` })
    // Act
    const title = await screen.findByRole('textbox', { name: /Title/ })
    await user.clear(title)
    await user.type(title, 'Replace pump seal')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    // Assert
    expect(fake.lastBody('PATCH', `/api/v1/cards/${String(card.id)}`)).toEqual({
      title: 'Replace pump seal',
    })
    const patch = fake.calls.find((c) => c.method === 'PATCH')
    expect(new Headers(patch?.init?.headers).get('If-Match')).toBe('"4"')
  })

  it('spins the comment submit while the post is in flight', async () => {
    // Arrange — the comment POST hangs, keeping the add mutation pending.
    const user = userEvent.setup()
    const fake = panelApp()
    const fetchFn = (input: string, init?: RequestInit) =>
      (init?.method ?? 'GET').toUpperCase() === 'POST' &&
      input.split('?')[0] === `/api/v1/cards/${String(card.id)}/comments`
        ? new Promise<Response>(() => undefined)
        : fake.fetch(input, init)
    renderApp({ fetchFn, route: `/cards/${String(card.id)}` })
    await screen.findByRole('textbox', { name: /Title/ })
    // Act — type a comment and submit it (the POST never resolves).
    await user.click(screen.getByRole('tab', { name: 'Comments' }))
    await user.type(await screen.findByRole('textbox', { name: 'Add a comment' }), 'Once only')
    await user.click(screen.getByRole('button', { name: 'Comment' }))
    // Assert — the submit shows the loading spinner while the request is pending
    // (re-query: Mantine re-renders the button when the loading state flips).
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Comment' })).toHaveAttribute(
        'data-loading',
        'true',
      )
    })
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
      [`GET /api/v1/cards/${String(card.id)}/comments`]: [existing],
      [`POST /api/v1/cards/${String(card.id)}/comments`]: makeComment({
        id: uid(112),
        cardId: card.id,
        body: 'New note',
      }),
      [`PATCH /api/v1/comments/${existing.id}`]: { ...existing, body: 'Edited note' },
      [`DELETE /api/v1/comments/${existing.id}`]: {},
    })
    renderApp({ fetchFn: fake.fetch, route: `/cards/${String(card.id)}` })
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
    // A confirmation guards the irreversible delete — confirm it.
    await user.click(await screen.findByRole('button', { name: 'Delete it' }))
    // Assert
    expect(fake.lastBody('POST', `/api/v1/cards/${String(card.id)}/comments`)).toEqual({
      body: 'New note',
    })
    expect(fake.lastBody('PATCH', `/api/v1/comments/${existing.id}`)).toEqual({
      body: 'Edited note',
    })
    expect(fake.calls.some((c) => c.method === 'DELETE')).toBe(true)
  })

  it('keeps the panel open when Escape dismisses a nested delete-comment confirm', async () => {
    // Arrange — a comment to delete, so the confirm dialog can open in-panel.
    const user = userEvent.setup()
    const existing = makeComment({
      id: uid(117),
      cardId: card.id,
      authorId: fixtureAdmin.id,
      body: 'Note to keep',
    })
    const fake = panelApp({ [`GET /api/v1/cards/${String(card.id)}/comments`]: [existing] })
    renderApp({ fetchFn: fake.fetch, route: `/cards/${String(card.id)}` })
    await screen.findByRole('textbox', { name: /Title/ })
    // Act — open the delete confirm, then press Escape to back out of it.
    await user.click(screen.getByRole('tab', { name: 'Comments' }))
    await user.click(await screen.findByRole('button', { name: 'Delete comment' }))
    expect(await screen.findByRole('button', { name: 'Delete it' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    // Assert — the confirm is gone but the whole card panel is still open, and
    // nothing was deleted (Escape only dismissed the nested dialog).
    expect(screen.queryByRole('button', { name: 'Delete it' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: /Card details/ })).toBeInTheDocument()
    expect(fake.calls.some((c) => c.method === 'DELETE')).toBe(false)
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
      [`GET /api/v1/cards/${String(card.id)}/comments`]: [deleted, reply],
    })
    renderApp({ fetchFn: fake.fetch, route: `/cards/${String(card.id)}` })
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
      [`GET /api/v1/cards/${String(card.id)}/events`]: () => {
        eventsCall += 1
        return eventsCall === 1
          ? { items: [first], nextCursor: 'cursor-2' }
          : { items: [second], nextCursor: null }
      },
    })
    renderApp({ fetchFn: fake.fetch, route: `/cards/${String(card.id)}` })
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
      'GET /api/v1/users/search': userSearchHandler,
      'GET /api/v1/locations': [],
      'GET /api/v1/tags': [],
      [`GET /api/v1/cards/${String(archived.id)}`]: {
        card: archived,
        tags: [],
        location: null,
        attachments: [],
      },
      [`GET /api/v1/cards/${String(archived.id)}/comments`]: [],
      [`GET /api/v1/cards/${String(archived.id)}/events`]: { items: [], nextCursor: null },
      [`POST /api/v1/cards/${String(archived.id)}/reopen`]: archived,
    })
    renderApp({ fetchFn: fake.fetch, route: `/cards/${String(archived.id)}` })
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
      [`POST /api/v1/cards/${String(card.id)}/comments`]: () =>
        problemResponse(409, { title: 'Card is archived' }),
    })
    renderApp({ fetchFn: fake.fetch, route: `/cards/${String(card.id)}` })
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
      'GET /api/v1/policy': policyRecordOf(permissivePolicy),
      [`GET /api/v1/cards/${String(card.id)}`]: {
        card: card,
        tags: [],
        location: null,
        attachments: [theirs],
      },
    })
    // Act
    renderApp({ fetchFn: fake.fetch, route: `/cards/${String(card.id)}` })
    // Assert
    expect(await screen.findByRole('img', { name: 'their-photo.png' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete their-photo.png' })).not.toBeInTheDocument()
  })

  it('orders the Details tab fields → relations → attachments → timestamps → sticky Save', async () => {
    // Arrange
    const fake = panelApp()
    // Act
    renderApp({ fetchFn: fake.fetch, route: `/cards/${String(card.id)}` })
    await screen.findByRole('textbox', { name: /Title/ })
    // Assert — the fields, the Relations heading, the Attachments section (its
    // FieldLabel help names the 25 MB / 10-file caps), the Updated timestamp, and
    // the Save button all render in the intended top-to-bottom order (relations
    // before attachments, #146), with Save last (the sticky footer at the bottom).
    const title = screen.getByRole('textbox', { name: /Title/ })
    const attachmentsHelp = screen.getByRole('button', { name: /25 MB each/ })
    const relations = screen.getByText('Relations')
    const updated = screen.getByText(/^Updated:/)
    const save = screen.getByRole('button', { name: 'Save changes' })
    const inOrder = [title, relations, attachmentsHelp, updated, save]
    for (let i = 0; i < inOrder.length - 1; i += 1) {
      // Each element PRECEDES the next in document order (mask includes bit 4).
      expect(inOrder[i]?.compareDocumentPosition(inOrder[i + 1] as Node)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      )
    }
  })

  it('opens the create view: same body, but no Save button and no Comments/History tabs', async () => {
    // Arrange — the New card flow signals create view via router state.created.
    const fake = panelApp()
    // Act
    renderApp({
      fetchFn: fake.fetch,
      route: `/cards/${String(card.id)}`,
      state: { created: true },
    })
    await screen.findByRole('textbox', { name: /Title/ })
    // Assert — the SAME relations + attachments sections render, but there is no
    // explicit Save (fields auto-save) and no Comments/History tabs; instead a
    // Discard/Done footer.
    expect(screen.getByText('Relations')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Comments' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'History' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument()
  })

  it('discards a draft via DELETE /cards/:id and closes the panel', async () => {
    // Arrange — Discard hard-deletes the fresh draft then returns to the board.
    const fake = panelApp({
      [`DELETE /api/v1/cards/${String(card.id)}`]: new Response(null, { status: 204 }),
    })
    // Act
    renderApp({
      fetchFn: fake.fetch,
      route: `/cards/${String(card.id)}`,
      state: { created: true },
    })
    await screen.findByRole('textbox', { name: /Title/ })
    // fireEvent (not userEvent): the footer's `Group grow` layout trips
    // userEvent's happy-dom visibility heuristic, though the button is a normal
    // clickable button in the browser. A direct click event is the honest test.
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    // Assert — a DELETE hit the card id, and the panel closed (dialog gone).
    await waitFor(() => {
      expect(
        fake.calls.some(
          (call) =>
            call.method === 'DELETE' &&
            (call.url.split('?')[0] ?? call.url) === `/api/v1/cards/${String(card.id)}`,
        ),
      ).toBe(true)
    })
    // Generous timeout: closing routes back to the board and unmounts the aside,
    // a multi-step update chain that can exceed the 1s default on a loaded runner.
    await waitFor(
      () => {
        expect(screen.queryByRole('dialog', { name: /Card details/ })).not.toBeInTheDocument()
      },
      { timeout: 4000 },
    )
  })

  it('puts the State dropdown inside the Details tab (not above the tabs)', async () => {
    // Arrange
    const fake = panelApp()
    // Act
    renderApp({ fetchFn: fake.fetch, route: `/cards/${String(card.id)}` })
    await screen.findByRole('textbox', { name: /Title/ })
    // Assert — the State select sits within the Details tabpanel, after the tab
    // list, so it moved out of the panel header area and into the tab body.
    const state = screen.getByRole('combobox', { name: 'State' })
    const detailsTab = screen.getByRole('tab', { name: 'Details' })
    // The tab (in the tablist) precedes the State control (in the tabpanel).
    expect(detailsTab.compareDocumentPosition(state)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(screen.getByRole('tabpanel')).toContainElement(state)
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
    const fake = panelApp({ [`POST /api/v1/cards/${String(card.id)}/attachments`]: stored })
    renderApp({ fetchFn: fake.fetch, route: `/cards/${String(card.id)}` })
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

  it('shows a blocked banner with the reason and an inline Unblock action', async () => {
    // Arrange
    const blocked = makeCard('in_progress', {
      title: 'Stuck job',
      blocked: true,
      blockedReason: 'Waiting on landlord approval',
      version: 3,
    })
    const user = userEvent.setup()
    const fake = createFakeFetch({
      'GET /api/v1/auth/me': fixtureAdmin,
      'GET /api/v1/board': makeBoard({ in_progress: [blocked] }),
      'GET /api/v1/policy': policyRecordOf(permissivePolicy),
      'GET /api/v1/users': fixturePickerUsers,
      'GET /api/v1/users/search': userSearchHandler,
      'GET /api/v1/locations': [],
      'GET /api/v1/tags': [],
      [`GET /api/v1/cards/${String(blocked.id)}`]: {
        card: blocked,
        tags: [],
        location: null,
        attachments: [],
      },
      [`GET /api/v1/cards/${String(blocked.id)}/comments`]: [],
      [`GET /api/v1/cards/${String(blocked.id)}/events`]: { items: [], nextCursor: null },
      [`POST /api/v1/cards/${String(blocked.id)}/unblock`]: { ...blocked, blocked: false },
    })
    renderApp({ fetchFn: fake.fetch, route: `/cards/${String(blocked.id)}` })
    // Act
    expect(await screen.findByText('This card is blocked')).toBeInTheDocument()
    expect(screen.getByText('Waiting on landlord approval')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Unblock' }))
    // Assert — unblock hit the API with the card's If-Match version
    const unblock = fake.calls.find((c) => c.url.includes('/unblock'))
    expect(new Headers(unblock?.init?.headers).get('If-Match')).toBe('"3"')
  })

  it('shows a cancelled banner naming the resolution with a Reopen action', async () => {
    // Arrange
    const cancelled = makeCard('done', {
      title: 'Scrapped job',
      resolution: 'cancelled',
      version: 4,
    })
    const fake = createFakeFetch({
      'GET /api/v1/auth/me': fixtureAdmin,
      'GET /api/v1/board': makeBoard({ done: [cancelled] }),
      'GET /api/v1/policy': policyRecordOf(permissivePolicy),
      'GET /api/v1/users': fixturePickerUsers,
      'GET /api/v1/users/search': userSearchHandler,
      'GET /api/v1/locations': [],
      'GET /api/v1/tags': [],
      [`GET /api/v1/cards/${String(cancelled.id)}`]: {
        card: cancelled,
        tags: [],
        location: null,
        attachments: [],
      },
      [`GET /api/v1/cards/${String(cancelled.id)}/comments`]: [],
      [`GET /api/v1/cards/${String(cancelled.id)}/events`]: { items: [], nextCursor: null },
    })
    // Act
    renderApp({ fetchFn: fake.fetch, route: `/cards/${String(cancelled.id)}` })
    // Assert
    expect(await screen.findByText('This card was cancelled')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reopen' })).toBeInTheDocument()
  })

  it('titles the banner grammatically for a duplicate resolution', async () => {
    // Arrange — "This card is duplicate" would be ungrammatical; assert the
    // resolution-specific phrasing instead.
    const duplicate = makeCard('done', {
      title: 'Dupe job',
      resolution: 'duplicate',
      version: 2,
    })
    const fake = createFakeFetch({
      'GET /api/v1/auth/me': fixtureAdmin,
      'GET /api/v1/board': makeBoard({ done: [duplicate] }),
      'GET /api/v1/policy': policyRecordOf(permissivePolicy),
      'GET /api/v1/users': fixturePickerUsers,
      'GET /api/v1/users/search': userSearchHandler,
      'GET /api/v1/locations': [],
      'GET /api/v1/tags': [],
      [`GET /api/v1/cards/${String(duplicate.id)}`]: {
        card: duplicate,
        tags: [],
        location: null,
        attachments: [],
      },
      [`GET /api/v1/cards/${String(duplicate.id)}/comments`]: [],
      [`GET /api/v1/cards/${String(duplicate.id)}/events`]: { items: [], nextCursor: null },
    })
    // Act
    renderApp({ fetchFn: fake.fetch, route: `/cards/${String(duplicate.id)}` })
    // Assert
    expect(await screen.findByText('This card is a duplicate')).toBeInTheDocument()
  })

  it('edits the waiting reason and resume date in place, PATCHing with If-Match', async () => {
    // Arrange — a card sitting in the waiting lane with a reason + resume date.
    const user = userEvent.setup()
    const waiting = makeCard('waiting_parts_vendor', {
      title: 'Awaiting part',
      waitingReason: 'parts',
      expectedResumeAt: '2026-08-01',
      version: 5,
    })
    const fake = createFakeFetch({
      'GET /api/v1/auth/me': fixtureAdmin,
      'GET /api/v1/board': makeBoard({ waiting_parts_vendor: [waiting] }),
      'GET /api/v1/policy': policyRecordOf(permissivePolicy),
      'GET /api/v1/users': fixturePickerUsers,
      'GET /api/v1/users/search': userSearchHandler,
      'GET /api/v1/locations': [],
      'GET /api/v1/tags': [],
      [`GET /api/v1/cards/${String(waiting.id)}`]: {
        card: waiting,
        tags: [],
        location: null,
        attachments: [],
      },
      [`GET /api/v1/cards/${String(waiting.id)}/comments`]: [],
      [`GET /api/v1/cards/${String(waiting.id)}/events`]: { items: [], nextCursor: null },
      [`PATCH /api/v1/cards/${String(waiting.id)}`]: {
        ...waiting,
        waitingReason: 'vendor',
        version: 6,
      },
    })
    renderApp({ fetchFn: fake.fetch, route: `/cards/${String(waiting.id)}` })
    // Act — wait for the panel body (its Title field) so we don't match the
    // lane label of the same name behind the non-modal panel.
    await screen.findByRole('textbox', { name: /Title/ })
    const save = screen.getByRole('button', { name: 'Save' })
    // Shown disabled via `data-disabled` so its "nothing to save" tooltip stays
    // hoverable (a native disabled button fires no hover events).
    expect(save).toHaveAttribute('data-disabled', 'true')
    // The banner reason is a Mantine Select (combobox); change it to Vendor.
    await user.click(screen.getByRole('combobox', { name: 'Waiting reason' }))
    await user.click(await screen.findByRole('option', { name: 'Vendor' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    // Assert — PATCH carried only the changed reason and the If-Match version.
    expect(fake.lastBody('PATCH', `/api/v1/cards/${String(waiting.id)}`)).toEqual({
      waitingReason: 'vendor',
      expectedResumeAt: '2026-08-01',
    })
    const patch = fake.calls.find((c) => c.method === 'PATCH')
    expect(new Headers(patch?.init?.headers).get('If-Match')).toBe('"5"')
  })

  it('surfaces an oversized upload (413) as a visible problem toast', async () => {
    // Arrange
    const user = userEvent.setup()
    const fake = panelApp({
      [`POST /api/v1/cards/${String(card.id)}/attachments`]: () =>
        problemResponse(413, { title: 'Upload too large' }),
    })
    renderApp({ fetchFn: fake.fetch, route: `/cards/${String(card.id)}` })
    await screen.findByRole('textbox', { name: /Title/ })
    // Act
    const file = new File(['png-bytes'], 'huge.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText<HTMLInputElement>('Browse files'), file)
    // Assert
    expect(await screen.findByText('Upload too large')).toBeInTheDocument()
  })
})
