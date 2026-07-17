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
    // Act — the facet panel is open by default; choose the P0 option
    await user.click(await screen.findByRole('combobox', { name: 'Priority' }))
    await user.click(await screen.findByRole('option', { name: 'P0 — Critical' }))
    // Assert
    const results = await screen.findByRole('list', { name: 'Search results' })
    expect(within(results).getByText('Burst pipe')).toBeInTheDocument()
    expect(lastCardsCall(fake)).toContain('priority=P0')
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
    // Assert
    const results = await screen.findByRole('list', { name: 'Search results' })
    expect(within(results).getByText('Grease door hinge')).toBeInTheDocument()
    expect(lastCardsCall(fake)).toContain('lane=in_progress')
  })

  it('opens a result in the card detail panel', async () => {
    // Arrange
    const found = makeCard('ready', { title: 'Fix pump', description: 'It leaks' })
    const user = userEvent.setup()
    const fake = searchApp({
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
