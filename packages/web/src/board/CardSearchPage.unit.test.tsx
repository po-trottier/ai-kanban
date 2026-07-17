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

describe('CardSearchPage', () => {
  it('submits the query to GET /cards and lists the matching cards', async () => {
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
    renderApp({ fetchFn: fake.fetch, route: '/search' })
    // Act
    await user.type(await screen.findByRole('textbox', { name: 'Search cards' }), 'pump')
    await user.click(screen.getByRole('button', { name: 'Search' }))
    // Assert
    const results = await screen.findByRole('list', { name: 'Search results' })
    expect(within(results).getByText('Fix pump')).toBeInTheDocument()
    const call = fake.calls.findLast((c) => c.url.startsWith('/api/v1/cards?'))
    expect(call?.url).toContain('q=pump')
  })

  it('reaches archived cards through the include-archived filter (guide.md)', async () => {
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
    renderApp({ fetchFn: fake.fetch, route: '/search' })
    await screen.findByText('No matching cards')
    // Act
    await user.click(screen.getByRole('checkbox', { name: 'Include archived' }))
    // Assert — the archived card is listed with its badge
    const results = await screen.findByRole('list', { name: 'Search results' })
    expect(within(results).getByText('Old job')).toBeInTheDocument()
    expect(within(results).getByText('Archived')).toBeInTheDocument()
  })

  it('shows the lane label as a context chip on each result row', async () => {
    // Arrange
    const match = makeCard('in_progress', { title: 'Grease door hinge' })
    const fake = searchApp({ 'GET /api/v1/cards': { items: [match], nextCursor: null } })
    // Act
    renderApp({ fetchFn: fake.fetch, route: '/search' })
    // Assert — the card's column rides along next to the status badges
    const results = await screen.findByRole('list', { name: 'Search results' })
    expect(within(results).getByText('Grease door hinge')).toBeInTheDocument()
    expect(within(results).getByText('In Progress')).toBeInTheDocument()
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
    renderApp({ fetchFn: fake.fetch, route: '/search' })
    // Act
    const results = await screen.findByRole('list', { name: 'Search results' })
    await user.click(within(results).getByText('Fix pump'))
    // Assert — the deep-linked detail drawer opens
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
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
    renderApp({ fetchFn: fake.fetch, route: '/search' })
    await screen.findByText('First page card')
    // Act
    await user.click(screen.getByRole('button', { name: 'Load more' }))
    // Assert
    expect(await screen.findByText('Second page card')).toBeInTheDocument()
    const call = fake.calls.findLast((c) => c.url.startsWith('/api/v1/cards?'))
    expect(call?.url).toContain('cursor=cursor-2')
  })
})
