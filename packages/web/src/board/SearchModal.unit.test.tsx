import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createFakeFetch, jsonResponse, type FakeFetch } from '../test/fake-fetch.ts'
import {
  fixtureAdmin,
  fixturePickerUsers,
  makeBoard,
  makeCard,
  permissivePolicy,
  policyRecordOf,
  uid,
} from '../test/fixtures.ts'
import { renderApp } from '../test/render.tsx'

function searchApp(routes: Record<string, unknown> = {}): FakeFetch {
  return createFakeFetch({
    'GET /api/v1/auth/me': fixtureAdmin,
    'GET /api/v1/board': makeBoard({}),
    'GET /api/v1/policy': policyRecordOf(permissivePolicy),
    'GET /api/v1/users': fixturePickerUsers,
    'GET /api/v1/locations': [],
    'GET /api/v1/tags': [],
    'GET /api/v1/cards': { items: [], nextCursor: null },
    ...routes,
  })
}

/** The most recent GET /cards request URL (the live search fires as facets change). */
function lastCardsCall(fake: FakeFetch): string | undefined {
  return fake.calls.findLast((call) => call.url.startsWith('/api/v1/cards?'))?.url
}

describe('SearchModal', () => {
  it('opens from the header sliders icon and lists cards (archived in scope by default)', async () => {
    // Arrange
    const user = userEvent.setup()
    const archived = makeCard('done', {
      title: 'Old job',
      resolution: 'completed',
      archivedAt: '2026-04-01T10:00:00.000Z',
    })
    const fake = searchApp({
      'GET /api/v1/cards': (_init: RequestInit | undefined, url: string) =>
        jsonResponse(
          url.includes('includeArchived=true')
            ? { items: [archived], nextCursor: null }
            : { items: [], nextCursor: null },
        ),
    })
    renderApp({ fetchFn: fake.fetch, route: '/' })
    // Act — the sliders icon in the header search field opens the modal on demand
    await user.click(await screen.findByRole('button', { name: 'Advanced search' }))
    // Assert — archived card is listed without toggling anything (default on)
    const results = await screen.findByRole('list', { name: 'Search results' })
    expect(within(results).getByText('Old job')).toBeInTheDocument()
    expect(within(results).getByText('Archived')).toBeInTheDocument()
    expect(lastCardsCall(fake)).toContain('includeArchived=true')
  })

  it('opens pre-populated from the current board query (?q=) and searches live', async () => {
    // Arrange
    const match = makeCard('ready', { title: 'Fix pump' })
    const fake = searchApp({
      'GET /api/v1/cards': (_init: RequestInit | undefined, url: string) =>
        jsonResponse(
          url.includes('q=pump')
            ? { items: [match], nextCursor: null }
            : { items: [], nextCursor: null },
        ),
    })
    // Act — deep-link with the modal open and a seed query
    renderApp({ fetchFn: fake.fetch, route: '/?q=pump&search=1' })
    // Assert — the field carries the seed and the matching card is listed
    expect(await screen.findByRole('textbox', { name: 'Search cards' })).toHaveValue('pump')
    const results = await screen.findByRole('list', { name: 'Search results' })
    expect(within(results).getByText('Fix pump')).toBeInTheDocument()
    expect(lastCardsCall(fake)).toContain('q=pump')
  })

  it('narrows results with the priority facet', async () => {
    // Arrange
    const user = userEvent.setup()
    const p0 = makeCard('ready', { title: 'Burst pipe', priority: 'P0' })
    const fake = searchApp({
      'GET /api/v1/cards': (_init: RequestInit | undefined, url: string) =>
        jsonResponse(
          url.includes('priority=P0')
            ? { items: [p0], nextCursor: null }
            : { items: [], nextCursor: null },
        ),
    })
    renderApp({ fetchFn: fake.fetch, route: '/?search=1' })
    // Act — the facet panel is open by default; choose P0, then apply via Search
    await user.click(await screen.findByRole('combobox', { name: 'Priority' }))
    await user.click(await screen.findByRole('option', { name: 'P0 — Critical' }))
    await user.click(screen.getByRole('button', { name: 'Search' }))
    // Assert
    const results = await screen.findByRole('list', { name: 'Search results' })
    expect(within(results).getByText('Burst pipe')).toBeInTheDocument()
    expect(lastCardsCall(fake)).toContain('priority=P0')
  })

  it('narrows results with the tags facet (multi-select, any-of)', async () => {
    // Arrange
    const user = userEvent.setup()
    const tagged = makeCard('ready', { title: 'HVAC job' })
    const fake = searchApp({
      'GET /api/v1/tags': [
        { id: uid(701), name: 'HVAC' },
        { id: uid(702), name: 'urgent' },
      ],
      'GET /api/v1/cards': (_init: RequestInit | undefined, url: string) =>
        jsonResponse(
          url.includes('tags=HVAC')
            ? { items: [tagged], nextCursor: null }
            : { items: [], nextCursor: null },
        ),
    })
    renderApp({ fetchFn: fake.fetch, route: '/?search=1' })
    // Act — pick a tag chip from the multi-select, then apply via Search
    await user.click(await screen.findByRole('combobox', { name: 'Tags' }))
    await user.click(await screen.findByRole('option', { name: 'HVAC' }))
    await user.click(screen.getByRole('button', { name: 'Search' }))
    // Assert
    const results = await screen.findByRole('list', { name: 'Search results' })
    expect(within(results).getByText('HVAC job')).toBeInTheDocument()
    expect(lastCardsCall(fake)).toContain('tags=HVAC')
  })

  it('restricts to archived-only through the 3-way archived-scope facet', async () => {
    // Arrange
    const user = userEvent.setup()
    const archived = makeCard('done', {
      title: 'Old job',
      resolution: 'completed',
      archivedAt: '2026-04-01T10:00:00.000Z',
    })
    const fake = searchApp({
      'GET /api/v1/cards': (_init: RequestInit | undefined, url: string) =>
        jsonResponse(
          url.includes('archivedOnly=true')
            ? { items: [archived], nextCursor: null }
            : { items: [], nextCursor: null },
        ),
    })
    renderApp({ fetchFn: fake.fetch, route: '/?search=1' })
    // Act — switch the archived scope to "Archived only", then apply via Search
    await user.click(await screen.findByRole('combobox', { name: 'Archived cards' }))
    await user.click(await screen.findByRole('option', { name: 'Archived only' }))
    await user.click(screen.getByRole('button', { name: 'Search' }))
    // Assert
    const results = await screen.findByRole('list', { name: 'Search results' })
    expect(within(results).getByText('Old job')).toBeInTheDocument()
    expect(lastCardsCall(fake)).toContain('archivedOnly=true')
  })

  it('narrows results with the column (lane) facet', async () => {
    // Arrange
    const user = userEvent.setup()
    const card = makeCard('in_progress', { title: 'Grease door hinge' })
    const fake = searchApp({
      'GET /api/v1/cards': (_init: RequestInit | undefined, url: string) =>
        jsonResponse(
          url.includes('lane=in_progress')
            ? { items: [card], nextCursor: null }
            : { items: [], nextCursor: null },
        ),
    })
    renderApp({ fetchFn: fake.fetch, route: '/?search=1' })
    // Act
    await user.click(await screen.findByRole('combobox', { name: 'Column' }))
    await user.click(await screen.findByRole('option', { name: 'In Progress' }))
    await user.click(screen.getByRole('button', { name: 'Search' }))
    // Assert
    const results = await screen.findByRole('list', { name: 'Search results' })
    expect(within(results).getByText('Grease door hinge')).toBeInTheDocument()
    expect(lastCardsCall(fake)).toContain('lane=in_progress')
  })

  it('batches edits — nothing queries until Search is pressed', async () => {
    // Arrange
    const user = userEvent.setup()
    const match = makeCard('ready', { title: 'Zebra card' })
    const fake = searchApp({
      'GET /api/v1/cards': (_init: RequestInit | undefined, url: string) =>
        jsonResponse(
          url.includes('q=zebra')
            ? { items: [match], nextCursor: null }
            : { items: [], nextCursor: null },
        ),
    })
    renderApp({ fetchFn: fake.fetch, route: '/?search=1' })
    await screen.findByText('No cards match your search.')
    // Act — typing does NOT fire a request carrying the term (no auto-apply)…
    await user.type(await screen.findByRole('textbox', { name: 'Search cards' }), 'zebra')
    expect(lastCardsCall(fake) ?? '').not.toContain('q=zebra')
    // …only pressing Search applies it.
    await user.click(screen.getByRole('button', { name: 'Search' }))
    // Assert
    expect(await screen.findByText('Zebra card')).toBeInTheDocument()
    expect(lastCardsCall(fake)).toContain('q=zebra')
  })

  it('resets the query and facets with Clear all', async () => {
    // Arrange
    const user = userEvent.setup()
    const match = makeCard('ready', { title: 'Fix pump' })
    const fake = searchApp({
      'GET /api/v1/cards': (_init: RequestInit | undefined, url: string) =>
        jsonResponse(
          url.includes('q=pump')
            ? { items: [match], nextCursor: null }
            : { items: [], nextCursor: null },
        ),
    })
    renderApp({ fetchFn: fake.fetch, route: '/?q=pump&search=1' })
    expect(await screen.findByText('Fix pump')).toBeInTheDocument()
    // Act
    await user.click(screen.getByRole('button', { name: 'Clear all' }))
    // Assert — the field empties and an empty search is applied (pump gone).
    expect(screen.getByRole('textbox', { name: 'Search cards' })).toHaveValue('')
    await screen.findByText('No cards match your search.')
    expect(lastCardsCall(fake)).not.toContain('q=pump')
  })

  it('opens a result in the card detail panel', async () => {
    // Arrange
    const found = makeCard('ready', { title: 'Fix pump', description: 'It leaks' })
    const user = userEvent.setup()
    const fake = searchApp({
      // The result deep-links by ticket number; an active card resolves to its
      // uuid from the board snapshot (where every active card lives).
      'GET /api/v1/board': makeBoard({ ready: [found] }),
      'GET /api/v1/cards': { items: [found], nextCursor: null },
      [`GET /api/v1/cards/${found.id}`]: {
        card: found,
        tags: [],
        location: null,
        attachments: [],
      },
      [`GET /api/v1/cards/${found.id}/comments`]: [],
      [`GET /api/v1/cards/${found.id}/events`]: { items: [], nextCursor: null },
    })
    renderApp({ fetchFn: fake.fetch, route: '/?search=1' })
    // Act
    const results = await screen.findByRole('list', { name: 'Search results' })
    await user.click(within(results).getByText('Fix pump'))
    // Assert — navigating to the card closes the modal and opens the detail panel
    expect(await screen.findByRole('textbox', { name: /Title/ })).toHaveValue('Fix pump')
  })

  it('loads the next page through the cursor', async () => {
    // Arrange
    const first = makeCard('ready', { title: 'First page card' })
    const second = makeCard('ready', { title: 'Second page card' })
    const fake = searchApp({
      'GET /api/v1/cards': (_init: RequestInit | undefined, url: string) =>
        jsonResponse(
          url.includes('cursor=cursor-2')
            ? { items: [second], nextCursor: null }
            : { items: [first], nextCursor: 'cursor-2' },
        ),
    })
    const user = userEvent.setup()
    renderApp({ fetchFn: fake.fetch, route: '/?search=1' })
    await screen.findByText('First page card')
    // Act
    await user.click(screen.getByRole('button', { name: 'Load more' }))
    // Assert
    expect(await screen.findByText('Second page card')).toBeInTheDocument()
    expect(lastCardsCall(fake)).toContain('cursor=cursor-2')
  })

  it('is reachable from the board filter no-matches state', async () => {
    // Arrange — a board with one card that the header filter (?q=zzz) hides
    const user = userEvent.setup()
    const fake = searchApp({
      'GET /api/v1/board': makeBoard({ ready: [makeCard('ready', { title: 'Visible card' })] }),
    })
    renderApp({ fetchFn: fake.fetch, route: '/?q=zzz' })
    // Act — the no-matches affordance opens advanced search
    await user.click(
      await screen.findByRole('link', { name: 'Search all cards, including archived' }),
    )
    // Assert — the modal opens, pre-populated with the board query
    expect(await screen.findByRole('textbox', { name: 'Search cards' })).toHaveValue('zzz')
  })
})
