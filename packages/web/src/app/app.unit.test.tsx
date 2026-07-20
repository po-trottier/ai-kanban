import { type PolicyDocument, type User } from '@rivian-kanban/core'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createFakeFetch, problemResponse, type FakeFetch } from '../test/fake-fetch.ts'
import {
  fixtureAdmin,
  fixturePickerUsers,
  fixtureTech,
  makeBoard,
  makeCard,
  permissivePolicy,
  policyRecordOf,
} from '../test/fixtures.ts'
import { renderApp } from '../test/render.tsx'

function authedRoutes(overrides: Record<string, unknown> = {}): FakeFetch {
  const card = makeCard('ready', { title: 'Fix pump' })
  return createFakeFetch({
    'GET /api/v1/auth/me': fixtureAdmin,
    'GET /api/v1/board': makeBoard({ ready: [card] }),
    'GET /api/v1/policy': policyRecordOf(permissivePolicy),
    'GET /api/v1/users': fixturePickerUsers,
    'GET /api/v1/users/search': fixturePickerUsers,
    'GET /api/v1/locations': [],
    'GET /api/v1/tags': [],
    'GET /api/v1/filter-presets': [],
    ...overrides,
  })
}

describe('app routing', () => {
  it('redirects to the login page when the session is missing (401 anywhere)', async () => {
    // Arrange
    const fake = createFakeFetch({
      'GET /api/v1/auth/me': () => problemResponse(401, { title: 'Unauthenticated' }),
      'GET /api/v1/setup': { required: false },
    })
    // Act
    renderApp({ fetchFn: fake.fetch })
    // Assert
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('redirects everything to /setup while the database has no users', async () => {
    // Arrange — no session AND the first-boot probe says setup is required.
    const fake = createFakeFetch({
      'GET /api/v1/auth/me': () => problemResponse(401, { title: 'Unauthenticated' }),
      'GET /api/v1/setup': { required: true },
    })
    // Act — landing on the login page must also end at /setup.
    renderApp({ fetchFn: fake.fetch, route: '/login' })
    // Assert
    expect(
      await screen.findByRole('heading', { name: 'Create the admin account' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument()
  })

  it('redirects /setup to the login page once any account exists', async () => {
    // Arrange
    const fake = createFakeFetch({ 'GET /api/v1/setup': { required: false } })
    // Act
    renderApp({ fetchFn: fake.fetch, route: '/setup' })
    // Assert
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Create the admin account' }),
    ).not.toBeInTheDocument()
  })

  it('renders the authenticated shell and board at /', async () => {
    // Arrange
    const user = userEvent.setup()
    const fake = authedRoutes()
    // Act
    renderApp({ fetchFn: fake.fetch })
    // Assert
    expect(await screen.findByText('Fix pump')).toBeInTheDocument()
    // The brand is now the logo + wordmark (ITEM 1), linking home; the app
    // title stays visible so the header identifies the app on any logo asset.
    expect(screen.getByRole('heading', { name: 'Facilities Kanban' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New work order' })).toBeInTheDocument()
    // Settings is the single entry point now — a menu item in the avatar
    // dropdown (the header gear is gone), reachable by every role.
    await user.click(screen.getByRole('button', { name: fixtureAdmin.displayName }))
    expect(await screen.findByRole('menuitem', { name: 'Settings' })).toBeInTheDocument()
  })

  it('shows the board filter bar above the board (the /search page + modal are gone)', async () => {
    // Arrange — search is no longer a separate page or modal; the filter bar
    // (below the header, above the board) is the one filtering surface.
    const fake = authedRoutes()
    // Act — the default route is the board.
    renderApp({ fetchFn: fake.fetch })
    // Assert — the board renders with the filter bar; its region + text-query
    // control are present, and the removed advanced-search field is not.
    expect(await screen.findByText('Fix pump')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Board filters' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Filter work orders' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Search work orders' })).not.toBeInTheDocument()
  })

  it('lets a non-admin open Settings and see only the Preferences tab', async () => {
    // Arrange — a plain user (no manage* grant): Settings is open to everyone
    // now (for their preferences), but the admin tabs stay gated.
    const fake = authedRoutes({ 'GET /api/v1/auth/me': fixtureTech })
    // Act
    renderApp({ fetchFn: fake.fetch, route: '/settings' })
    // Assert — the Preferences tab and its theme selector are present; none of
    // the admin tabs render, and there is no admins-only wall.
    expect(await screen.findByRole('tab', { name: 'Preferences' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'System' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Users' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Permissions' })).not.toBeInTheDocument()
    expect(screen.queryByText('Only admins can open settings.')).not.toBeInTheDocument()
  })

  it('gates each admin tab on its own permission (per-tab, ADR-013)', async () => {
    // Arrange — a custom role keyed 'auditor' (not 'admin') granting ONLY
    // manageLocations: it must see Preferences + Locations, and nothing else.
    const auditor: User = { ...fixtureAdmin, role: 'auditor' }
    const policy: PolicyDocument = {
      ...permissivePolicy,
      roles: [
        ...permissivePolicy.roles,
        { key: 'auditor', name: 'Auditor', permissions: { manageLocations: true } },
      ],
    }
    const fake = authedRoutes({
      'GET /api/v1/auth/me': auditor,
      'GET /api/v1/policy': policyRecordOf(policy),
    })
    // Act
    renderApp({ fetchFn: fake.fetch, route: '/settings' })
    // Assert — the Locations tab appears (its grant); Preferences is always
    // there; the tabs whose permission this role lacks do NOT render.
    expect(await screen.findByRole('tab', { name: 'Locations' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Preferences' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Users' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Permissions' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Service tokens' })).not.toBeInTheDocument()
  })

  it('interposes the change-password page while must_change_password is set', async () => {
    // Arrange
    const fake = createFakeFetch({
      'GET /api/v1/auth/me': { ...fixtureAdmin, mustChangePassword: true },
    })
    // Act
    renderApp({ fetchFn: fake.fetch })
    // Assert
    expect(await screen.findByRole('heading', { name: 'Change your password' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New work order' })).not.toBeInTheDocument()
  })

  it('shows a full-page error when the session check fails for non-auth reasons', async () => {
    // Arrange
    const fake = createFakeFetch({
      'GET /api/v1/auth/me': () => problemResponse(503, { title: 'Service warming up' }),
    })
    // Act
    renderApp({ fetchFn: fake.fetch })
    // Assert
    expect(await screen.findByText('Service warming up')).toBeInTheDocument()
  })

  it('logs out through the user menu and returns to the login page', async () => {
    // Arrange
    const user = userEvent.setup()
    const fake = authedRoutes({
      'POST /api/v1/auth/logout': {},
      'GET /api/v1/setup': { required: false },
    })
    renderApp({ fetchFn: fake.fetch })
    await screen.findByText('Fix pump')
    // Act
    await user.click(screen.getByRole('button', { name: fixtureAdmin.displayName }))
    await user.click(await screen.findByRole('menuitem', { name: 'Log out' }))
    // Assert
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(fake.calls.some((c) => c.url === '/api/v1/auth/logout')).toBe(true)
  })

  it('deep-links the card detail panel at /cards/:id over the board', async () => {
    // Arrange
    const card = makeCard('ready', { title: 'Fix pump', description: 'It leaks' })
    const fake = authedRoutes({
      'GET /api/v1/board': makeBoard({ ready: [card] }),
      [`GET /api/v1/cards/${String(card.id)}`]: {
        card: card,
        tags: [],
        location: null,
        attachments: [],
      },
      [`GET /api/v1/cards/${String(card.id)}/comments`]: [],
      [`GET /api/v1/cards/${String(card.id)}/events`]: { items: [], nextCursor: null },
    })
    // Act
    renderApp({ fetchFn: fake.fetch, route: `/cards/${String(card.id)}` })
    // Assert
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(await screen.findByRole('textbox', { name: /Title/ })).toHaveValue('Fix pump')
  })

  it('closing the New work order modal with ✕ creates nothing — the board stays empty', async () => {
    // Arrange — a STATEFUL board like the real server: a card appears ONLY after
    // POST /cards. Reproduces the PO's flow (open → ✕) and proves the board is
    // still empty after — no draft was ever created (the flakiness is gone).
    const user = userEvent.setup()
    const fake = emptyBoardFake()
    // Act — open the form from the header button, then close it with ✕. (The
    // empty board renders its OWN New work order CTA, so scope to the header.)
    renderApp({ fetchFn: fake.fetch })
    const header = await screen.findByRole('banner')
    await user.click(within(header).getByRole('button', { name: 'New work order' }))
    const dialog = await screen.findByRole('dialog', { name: 'New work order' })
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    // Assert — nothing was POSTed and the board shows its empty-state CTA.
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'New work order' })).not.toBeInTheDocument()
    })
    expect(fake.calls.some((call) => call.method === 'POST')).toBe(false)
    expect(screen.getByText('No work orders yet')).toBeInTheDocument()
  })

  it('Create commits the work order — it POSTs the fields and appears on the board', async () => {
    // Arrange — the board is empty until POST /cards flips it, mirroring the real
    // server: Create is the ONLY thing that puts a card on the board.
    const user = userEvent.setup()
    const fake = emptyBoardFake()
    // Act — open (from the header, since the empty board has its own CTA), fill
    // the title, Create.
    renderApp({ fetchFn: fake.fetch })
    const header = await screen.findByRole('banner')
    await user.click(within(header).getByRole('button', { name: 'New work order' }))
    await screen.findByRole('dialog', { name: 'New work order' })
    await user.type(screen.getByRole('textbox', { name: /Title/ }), 'Broken door')
    await user.click(screen.getByRole('button', { name: 'Create' }))
    // Assert — the fields POSTed and the created card is now on the board.
    expect(await screen.findByText('Broken door')).toBeInTheDocument()
    expect(fake.lastBody('POST', '/api/v1/cards')).toEqual({
      title: 'Broken door',
      description: '',
      priority: 'P2',
      tags: [],
    })
  })
})

/**
 * A stateful full-app fake whose board is empty until `POST /cards` flips it —
 * exactly the server contract the create flow must respect (nothing on the board
 * until commit). Reused by the ✕-creates-nothing and Create-commits app tests.
 */
function emptyBoardFake(): FakeFetch {
  const created = makeCard('intake', { title: 'Broken door', version: 1 })
  let hasCard = false
  return createFakeFetch({
    'GET /api/v1/auth/me': fixtureAdmin,
    'GET /api/v1/board': () => makeBoard(hasCard ? { intake: [created] } : {}),
    'GET /api/v1/policy': policyRecordOf(permissivePolicy),
    'GET /api/v1/users': fixturePickerUsers,
    'GET /api/v1/users/search': fixturePickerUsers,
    'GET /api/v1/locations': [],
    'GET /api/v1/tags': [],
    'GET /api/v1/filter-presets': [],
    'POST /api/v1/cards': () => {
      hasCard = true
      return created
    },
  })
}
