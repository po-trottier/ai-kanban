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
    'GET /api/v1/locations': [],
    'GET /api/v1/tags': [],
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
    const fake = authedRoutes()
    // Act
    renderApp({ fetchFn: fake.fetch })
    // Assert
    expect(await screen.findByText('Fix pump')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Facilities Kanban' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New card' })).toBeInTheDocument()
    expect(screen.getByLabelText('Settings')).toBeInTheDocument()
  })

  it('hides the settings gear from non-admins and gates /settings in the UI', async () => {
    // Arrange
    const fake = authedRoutes({ 'GET /api/v1/auth/me': fixtureTech })
    // Act
    renderApp({ fetchFn: fake.fetch, route: '/settings' })
    // Assert
    expect(await screen.findByText('Only admins can open settings.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Settings')).not.toBeInTheDocument()
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
    expect(screen.queryByRole('button', { name: 'New card' })).not.toBeInTheDocument()
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
      [`GET /api/v1/cards/${card.id}`]: {
        card: card,
        tags: [],
        location: null,
        attachments: [],
      },
      [`GET /api/v1/cards/${card.id}/comments`]: [],
      [`GET /api/v1/cards/${card.id}/events`]: { items: [], nextCursor: null },
    })
    // Act
    renderApp({ fetchFn: fake.fetch, route: `/cards/${card.id}` })
    // Assert
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(await screen.findByRole('textbox', { name: /Title/ })).toHaveValue('Fix pump')
  })
})
