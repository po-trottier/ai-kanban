import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import {
  createFakeFetch,
  jsonResponse,
  problemResponse,
  type FakeFetch,
  type FakeRouteResult,
} from '../test/fake-fetch.ts'
import {
  fixtureAdmin,
  fixturePickerUsers,
  makeBoard,
  nth,
  makeCard,
  permissivePolicy,
  policyDenyingUser,
  policyRecordOf,
} from '../test/fixtures.ts'
import { renderApp } from '../test/render.tsx'
import dayjs from '../lib/dayjs.ts'
import { type Card } from '@rivian-kanban/core'

// The resume-date picker's `minDate` is "today" in the viewer's zone (the LA
// fixture admin), so the move test must pick today DYNAMICALLY — a hard-coded
// calendar date silently becomes unselectable (past `minDate`) once the clock
// rolls past it, exactly like the sibling WaitingLaneModal / EstimateInput tests.
const RESUME_TZ = 'America/Los_Angeles'
const resumeTodayLabel = dayjs().tz(RESUME_TZ).format('D MMMM YYYY')
const resumeTodayIso = dayjs().tz(RESUME_TZ).format('YYYY-MM-DD')

/** The filter bar's async assignee/reporter pickers hit `GET /users/search`. */
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

function boardApp(
  cards: { ready?: Card[]; intake?: Card[] },
  extra: Record<string, unknown> = {},
): FakeFetch {
  return createFakeFetch({
    'GET /api/v1/auth/me': fixtureAdmin,
    'GET /api/v1/board': makeBoard(cards),
    'GET /api/v1/policy': policyRecordOf(permissivePolicy),
    'GET /api/v1/users': fixturePickerUsers,
    'GET /api/v1/users/search': userSearchHandler,
    'GET /api/v1/locations': [],
    'GET /api/v1/tags': [],
    'GET /api/v1/filter-presets': [],
    ...extra,
  })
}

async function openCardMenu(user: ReturnType<typeof userEvent.setup>, title: string) {
  const card = await screen.findByLabelText(title)
  await user.click(within(card).getByRole('button', { name: 'Work order actions' }))
}

describe('BoardPage move flows', () => {
  it('sends only neighbor ids + If-Match through the Move to… menu (ADR-007)', async () => {
    // Arrange
    const user = userEvent.setup()
    const a = makeCard('ready', { title: 'First in ready' })
    const moving = makeCard('intake', { title: 'Triaged card', version: 7 })
    const fake = boardApp(
      { ready: [a], intake: [moving] },
      { [`POST /api/v1/cards/${String(moving.id)}/move`]: moving },
    )
    renderApp({ fetchFn: fake.fetch })
    // Act
    await openCardMenu(user, 'Triaged card')
    await user.click(await screen.findByRole('menuitem', { name: 'Move to…' }))
    await user.click(await screen.findByRole('combobox', { name: 'Column' }))
    await user.click(screen.getByRole('option', { name: 'Ready' }))
    await user.click(screen.getByRole('combobox', { name: 'Position' }))
    // Ready holds one card, so the bottom is the explicit "Last" option now.
    await user.click(screen.getByRole('option', { name: 'Last (bottom)' }))
    await user.click(screen.getByRole('button', { name: 'Move' }))
    // Assert
    expect(fake.lastBody('POST', `/api/v1/cards/${String(moving.id)}/move`)).toEqual({
      toLane: 'ready',
      prevCardId: a.id,
      nextCardId: null,
    })
    const call = fake.calls.find((c) => c.method === 'POST' && c.url.includes('/move'))
    expect(new Headers(call?.init?.headers).get('If-Match')).toBe('"7"')
  })

  it('collects the waiting reason and resume date inline in the move modal', async () => {
    // Arrange
    const user = userEvent.setup()
    const moving = makeCard('intake', { title: 'Needs parts', version: 2 })
    const fake = boardApp(
      { intake: [moving] },
      { [`POST /api/v1/cards/${String(moving.id)}/move`]: moving },
    )
    renderApp({ fetchFn: fake.fetch })
    // Act — picking the waiting lane reveals the reason + date in the SAME
    // modal (no confusing second hop), and Move stays disabled until both set.
    await openCardMenu(user, 'Needs parts')
    await user.click(await screen.findByRole('menuitem', { name: 'Move to…' }))
    await user.click(await screen.findByRole('combobox', { name: 'Column' }))
    await user.click(screen.getByRole('option', { name: 'Waiting on Parts / Vendor' }))
    // Move is shown disabled via `data-disabled` (keeps its reason tooltip
    // hoverable) until both required waiting fields are set.
    expect(screen.getByRole('button', { name: 'Move' })).toHaveAttribute('data-disabled', 'true')
    await user.click(await screen.findByRole('combobox', { name: 'Waiting reason' }))
    await user.click(screen.getByRole('option', { name: 'Vendor' }))
    await user.click(screen.getByRole('button', { name: 'Expected resume date' }))
    await user.click(nth(screen.getAllByRole('button', { name: resumeTodayLabel }), 0))
    await user.click(screen.getByRole('button', { name: 'Move' }))
    // Assert
    expect(fake.lastBody('POST', `/api/v1/cards/${String(moving.id)}/move`)).toMatchObject({
      toLane: 'waiting_parts_vendor',
      waitingReason: 'vendor',
      expectedResumeAt: resumeTodayIso,
    })
  })

  it('rolls back and shows the conflict toast on a 409 (ADR-012)', async () => {
    // Arrange
    const user = userEvent.setup()
    const a = makeCard('ready', { title: 'Target neighbor' })
    const moving = makeCard('intake', { title: 'Contended card', version: 1 })
    const fake = boardApp(
      { ready: [a], intake: [moving] },
      {
        [`POST /api/v1/cards/${String(moving.id)}/move`]: () =>
          problemResponse(409, { title: 'Conflict' }),
      },
    )
    renderApp({ fetchFn: fake.fetch })
    // Act
    await openCardMenu(user, 'Contended card')
    await user.click(await screen.findByRole('menuitem', { name: 'Move to…' }))
    await user.click(await screen.findByRole('combobox', { name: 'Column' }))
    await user.click(screen.getByRole('option', { name: 'Ready' }))
    await user.click(screen.getByRole('button', { name: 'Move' }))
    // Assert
    expect(
      await screen.findByText(
        'This work order was just updated by someone else — the board has been refreshed.',
      ),
    ).toBeInTheDocument()
    const intake = screen.getByRole('list', { name: 'Work orders in Intake' })
    expect(within(intake).getByText('Contended card')).toBeInTheDocument()
  })
})

describe('BoardPage filter bar (server-side filtering)', () => {
  it('fetches the narrowed board via POST /board/query as the query changes', async () => {
    // Arrange — the filtered endpoint returns only the matching card; the
    // unfiltered GET /board carries both. Filtering is API-level now (the server
    // narrows the board), not a client-side pass over the loaded board.
    const user = userEvent.setup()
    const match = makeCard('intake', { title: 'Leaking faucet' })
    const other = makeCard('ready', { title: 'Broken window' })
    const fake = boardApp(
      { intake: [match], ready: [other] },
      { 'POST /api/v1/board/query': makeBoard({ intake: [match] }) },
    )
    renderApp({ fetchFn: fake.fetch })
    expect(await screen.findByLabelText('Broken window')).toBeInTheDocument()
    // Act — type in the filter-bar query; the debounced change drives one query.
    await user.type(screen.getByRole('textbox', { name: 'Filter work orders' }), 'faucet')
    // Assert — the narrowed board arrives (non-match gone), and the request body
    // is the BoardFilter with the typed query.
    expect(await screen.findByLabelText('Leaking faucet')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByLabelText('Broken window')).not.toBeInTheDocument()
    })
    // Poll for the debounced query: the board can narrow on an earlier keystroke,
    // so the final `q: 'faucet'` request may still be in flight here (CI flake).
    await waitFor(() => {
      expect(fake.lastBody('POST', '/api/v1/board/query')).toMatchObject({ q: 'faucet' })
    })
  })

  it('applies a filter straight from the URL on load (a shared link)', async () => {
    // Arrange — a deep link whose query string already narrows the board; the
    // filter is URL state, so opening the link must filter without any typing.
    const match = makeCard('intake', { title: 'Leaking faucet' })
    const other = makeCard('ready', { title: 'Broken window' })
    const fake = boardApp(
      { intake: [match], ready: [other] },
      { 'POST /api/v1/board/query': makeBoard({ intake: [match] }) },
    )
    // Act — render the app AT the shared URL.
    renderApp({ fetchFn: fake.fetch, route: '/?q=faucet' })
    // Assert — the narrowed board loads (non-match absent), the request carried
    // the URL's query, and the search box reflects it.
    expect(await screen.findByLabelText('Leaking faucet')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByLabelText('Broken window')).not.toBeInTheDocument()
    })
    expect(fake.lastBody('POST', '/api/v1/board/query')).toMatchObject({ q: 'faucet' })
    expect(screen.getByRole('textbox', { name: 'Filter work orders' })).toHaveValue('faucet')
  })

  it('returns to the unfiltered board (GET /board) when Reset filters is pressed', async () => {
    // Arrange — the filtered endpoint narrows to one card; clearing must go back
    // to the unfiltered GET /board (both cards), which is the empty-filter path.
    const user = userEvent.setup()
    const match = makeCard('intake', { title: 'Leaking faucet' })
    const other = makeCard('ready', { title: 'Broken window' })
    const fake = boardApp(
      { intake: [match], ready: [other] },
      { 'POST /api/v1/board/query': makeBoard({ intake: [match] }) },
    )
    renderApp({ fetchFn: fake.fetch })
    await screen.findByLabelText('Broken window')
    // Act — filter down to one card…
    await user.type(screen.getByRole('textbox', { name: 'Filter work orders' }), 'faucet')
    await waitFor(() => {
      expect(screen.queryByLabelText('Broken window')).not.toBeInTheDocument()
    })
    // …then Reset filters restores the full unfiltered board.
    await user.click(screen.getByRole('button', { name: 'Reset filters' }))
    // Assert — both cards are back (the empty filter reads GET /board again).
    expect(await screen.findByLabelText('Broken window')).toBeInTheDocument()
    expect(screen.getByLabelText('Leaking faucet')).toBeInTheDocument()
  })
})

describe('BoardPage card actions', () => {
  it('blocks a card with a reason through the ⋯ menu', async () => {
    // Arrange
    const user = userEvent.setup()
    const card = makeCard('in_progress', { title: 'Stuck card', version: 3 })
    const fake = boardApp(
      { intake: [card] },
      { [`POST /api/v1/cards/${String(card.id)}/block`]: jsonResponse(card) },
    )
    renderApp({ fetchFn: fake.fetch })
    // Act
    await openCardMenu(user, 'Stuck card')
    await user.click(await screen.findByRole('menuitem', { name: 'Block…' }))
    await user.type(
      screen.getByRole('textbox', { name: 'What is blocking this work order?' }),
      'vendor no-show',
    )
    await user.click(screen.getByRole('button', { name: 'Block work order' }))
    // Assert
    expect(fake.lastBody('POST', `/api/v1/cards/${String(card.id)}/block`)).toEqual({
      reason: 'vendor no-show',
    })
  })

  it('cancels a card with a resolution through the ⋯ menu (never a drag)', async () => {
    // Arrange
    const user = userEvent.setup()
    const card = makeCard('intake', { title: 'Duplicate request', version: 5 })
    const fake = boardApp(
      { intake: [card] },
      { [`POST /api/v1/cards/${String(card.id)}/cancel`]: jsonResponse(card) },
    )
    renderApp({ fetchFn: fake.fetch })
    // Act
    await openCardMenu(user, 'Duplicate request')
    await user.click(await screen.findByRole('menuitem', { name: 'Cancel…' }))
    await user.click(screen.getByRole('combobox', { name: 'Reason' }))
    await user.click(screen.getByRole('option', { name: 'Duplicate' }))
    await user.click(screen.getByRole('button', { name: 'Cancel work order' }))
    // Assert
    expect(fake.lastBody('POST', `/api/v1/cards/${String(card.id)}/cancel`)).toEqual({
      resolution: 'duplicate',
    })
    const call = fake.calls.find((c) => c.url.includes('/cancel'))
    expect(new Headers(call?.init?.headers).get('If-Match')).toBe('"5"')
  })

  it('unblocks a blocked card directly from the menu', async () => {
    // Arrange
    const user = userEvent.setup()
    const card = makeCard('in_progress', {
      title: 'Blocked card',
      blocked: true,
      blockedReason: 'no parts',
      blockedAt: '2026-07-10T08:00:00.000Z',
      version: 2,
    })
    const fake = boardApp(
      { intake: [card] },
      { [`POST /api/v1/cards/${String(card.id)}/unblock`]: jsonResponse(card) },
    )
    renderApp({ fetchFn: fake.fetch })
    // Act
    await openCardMenu(user, 'Blocked card')
    await user.click(await screen.findByRole('menuitem', { name: 'Unblock' }))
    // Assert
    expect(fake.lastBody('POST', `/api/v1/cards/${String(card.id)}/unblock`)).toEqual({})
  })

  it('reopens a terminal card from the menu (cancel is replaced by reopen)', async () => {
    // Arrange
    const user = userEvent.setup()
    const card = makeCard('done', { title: 'Finished card', resolution: 'completed', version: 9 })
    const fake = boardApp(
      { intake: [card] },
      { [`POST /api/v1/cards/${String(card.id)}/reopen`]: jsonResponse(card) },
    )
    renderApp({ fetchFn: fake.fetch })
    // Act
    await openCardMenu(user, 'Finished card')
    await user.click(await screen.findByRole('menuitem', { name: 'Reopen' }))
    // Assert
    expect(fake.lastBody('POST', `/api/v1/cards/${String(card.id)}/reopen`)).toEqual({})
    const call = fake.calls.find((c) => c.url.includes('/reopen'))
    expect(new Headers(call?.init?.headers).get('If-Match')).toBe('"9"')
  })

  it('archives a Done card from the menu (If-Match) and shows only for terminal cards', async () => {
    // Arrange — a completed card exposes Reopen + Archive; a live one does not.
    const user = userEvent.setup()
    const done = makeCard('done', { title: 'Closed job', resolution: 'completed', version: 7 })
    const live = makeCard('intake', { title: 'Open job' })
    const fake = createFakeFetch({
      'GET /api/v1/auth/me': fixtureAdmin,
      'GET /api/v1/board': makeBoard({ done: [done], intake: [live] }),
      'GET /api/v1/policy': policyRecordOf(permissivePolicy),
      'GET /api/v1/users': fixturePickerUsers,
      'GET /api/v1/users/search': userSearchHandler,
      'GET /api/v1/locations': [],
      'GET /api/v1/tags': [],
      [`POST /api/v1/cards/${String(done.id)}/archive`]: jsonResponse({
        ...done,
        archivedAt: '2026-07-16T00:00:00.000Z',
      }),
    })
    renderApp({ fetchFn: fake.fetch })
    // Act — the live card's menu has no Archive item.
    await openCardMenu(user, 'Open job')
    expect(screen.queryByRole('menuitem', { name: 'Archive' })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    // …but the Done card's menu does; clicking it archives via the API.
    await openCardMenu(user, 'Closed job')
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }))
    // Assert
    expect(fake.lastBody('POST', `/api/v1/cards/${String(done.id)}/archive`)).toEqual({})
    const call = fake.calls.find((c) => c.url.includes('/archive'))
    expect(new Headers(call?.init?.headers).get('If-Match')).toBe('"7"')
    expect(await screen.findByText('Work order archived')).toBeInTheDocument()
  })

  it('shows the problem+json error when the board fails to load', async () => {
    // Arrange
    const fake = createFakeFetch({
      'GET /api/v1/auth/me': fixtureAdmin,
      'GET /api/v1/board': () => problemResponse(500, { title: 'Database unavailable' }),
      'GET /api/v1/policy': policyRecordOf(permissivePolicy),
      'GET /api/v1/users': fixturePickerUsers,
      'GET /api/v1/users/search': userSearchHandler,
      'GET /api/v1/locations': [],
      'GET /api/v1/tags': [],
    })
    // Act
    renderApp({ fetchFn: fake.fetch })
    // Assert
    expect(await screen.findByText('Database unavailable')).toBeInTheDocument()
  })

  it('surfaces non-conflict move failures as an error toast', async () => {
    // Arrange
    const user = userEvent.setup()
    const moving = makeCard('intake', { title: 'Doomed move' })
    const fake = boardApp(
      { intake: [moving] },
      {
        [`POST /api/v1/cards/${String(moving.id)}/move`]: () =>
          problemResponse(422, { title: 'Illegal transition' }),
      },
    )
    renderApp({ fetchFn: fake.fetch })
    // Act
    await openCardMenu(user, 'Doomed move')
    await user.click(await screen.findByRole('menuitem', { name: 'Move to…' }))
    await user.click(await screen.findByRole('combobox', { name: 'Column' }))
    await user.click(screen.getByRole('option', { name: 'Done' }))
    await user.click(screen.getByRole('button', { name: 'Move' }))
    // Assert
    expect(await screen.findByText('Illegal transition')).toBeInTheDocument()
  })

  it('disables cancel when the policy gates it below the user role', async () => {
    // Arrange
    const user = userEvent.setup()
    const card = makeCard('intake', { title: 'Gated card' })
    const gatedPolicy = policyDenyingUser('card.cancel')
    const fake = createFakeFetch({
      'GET /api/v1/auth/me': { ...fixtureAdmin, role: 'user' },
      'GET /api/v1/board': makeBoard({ intake: [card] }),
      'GET /api/v1/policy': policyRecordOf(gatedPolicy),
      'GET /api/v1/users': fixturePickerUsers,
      'GET /api/v1/users/search': userSearchHandler,
      'GET /api/v1/locations': [],
      'GET /api/v1/tags': [],
    })
    renderApp({ fetchFn: fake.fetch })
    // Act
    await openCardMenu(user, 'Gated card')
    // Assert
    expect(await screen.findByRole('menuitem', { name: 'Cancel…' })).toHaveAttribute(
      'data-disabled',
    )
  })
})
