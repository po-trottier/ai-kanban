import { type Location } from '@rivian-kanban/core'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createFakeFetch, problemResponse, type FakeFetch } from '../test/fake-fetch.ts'
import {
  fixtureAdmin,
  fixturePickerUsers,
  makeBoard,
  makeCard,
  permissivePolicy,
  policyRecordOf,
  uid,
} from '../test/fixtures.ts'
import { renderApp, renderWithProviders } from '../test/render.tsx'
import { SetupPage } from './SetupPage.tsx'

/** The first-boot state: the database has no users yet. */
const setupRequired = { 'GET /api/v1/setup': { required: true } }

/**
 * Routes for the full two-step wizard through the real route table: the
 * first-boot probe, the setup POST that mints the session, and the board data
 * that Step 2's "Skip"/"Continue" (both navigate to /) then lands on.
 */
function wizardRoutes(overrides: Record<string, unknown> = {}): FakeFetch {
  return createFakeFetch({
    ...setupRequired,
    'POST /api/v1/setup': fixtureAdmin,
    'GET /api/v1/auth/me': fixtureAdmin,
    'GET /api/v1/board': makeBoard({ ready: [makeCard('ready', { title: 'Fix pump' })] }),
    'GET /api/v1/policy': policyRecordOf(permissivePolicy),
    'GET /api/v1/users': fixturePickerUsers,
    'GET /api/v1/locations': [],
    'GET /api/v1/tags': [],
    ...overrides,
  })
}

/** Step 1: fill the admin account form and submit. */
async function createAdmin(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByRole('textbox', { name: 'Email' }), 'first@org.example')
  await user.type(screen.getByRole('textbox', { name: 'Display name' }), 'First Admin')
  await user.type(screen.getByLabelText('Password'), 'a-strong-first-password')
  await user.click(screen.getByRole('button', { name: 'Create admin account' }))
}

describe('SetupPage', () => {
  it('carries the product branding above the setup heading', async () => {
    // Arrange
    const fake = createFakeFetch({ ...setupRequired })
    // Act
    renderWithProviders(<SetupPage />, { fetchFn: fake.fetch })
    // Assert
    expect(await screen.findByRole('heading', { name: 'Facilities Kanban' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Create the admin account' })).toBeInTheDocument()
  })

  it('validates email, display name, and the password policy minimum before submitting', async () => {
    // Arrange
    const user = userEvent.setup()
    const fake = createFakeFetch({ ...setupRequired })
    renderWithProviders(<SetupPage />, { fetchFn: fake.fetch })
    // Act
    await user.type(await screen.findByRole('textbox', { name: 'Email' }), 'not-an-email')
    await user.type(screen.getByLabelText('Password'), 'short')
    await user.click(screen.getByRole('button', { name: 'Create admin account' }))
    // Assert
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument()
    expect(await screen.findByText('Enter a display name')).toBeInTheDocument()
    expect(await screen.findByText('Password must be at least 12 characters')).toBeInTheDocument()
    expect(fake.calls.filter((call) => call.method === 'POST')).toHaveLength(0)
  })

  it('posts the account to /setup on a valid submit', async () => {
    // Arrange
    const user = userEvent.setup()
    const fake = createFakeFetch({ ...setupRequired, 'POST /api/v1/setup': fixtureAdmin })
    renderWithProviders(<SetupPage />, { fetchFn: fake.fetch })
    // Act
    await user.type(await screen.findByRole('textbox', { name: 'Email' }), 'first@org.example')
    await user.type(screen.getByRole('textbox', { name: 'Display name' }), 'First Admin')
    await user.type(screen.getByLabelText('Password'), 'a-strong-first-password')
    await user.click(screen.getByRole('button', { name: 'Create admin account' }))
    // Assert
    expect(fake.lastBody('POST', '/api/v1/setup')).toEqual({
      email: 'first@org.example',
      displayName: 'First Admin',
      password: 'a-strong-first-password',
    })
  })

  it('renders the problem+json title when the server rejects the setup', async () => {
    // Arrange
    const user = userEvent.setup()
    const fake = createFakeFetch({
      ...setupRequired,
      'POST /api/v1/setup': () => problemResponse(409, { title: 'Setup already complete' }),
    })
    renderWithProviders(<SetupPage />, { fetchFn: fake.fetch })
    // Act
    await user.type(await screen.findByRole('textbox', { name: 'Email' }), 'late@org.example')
    await user.type(screen.getByRole('textbox', { name: 'Display name' }), 'Latecomer')
    await user.type(screen.getByLabelText('Password'), 'a-strong-late-password')
    await user.click(screen.getByRole('button', { name: 'Create admin account' }))
    // Assert
    expect(await screen.findByText('Setup already complete')).toBeInTheDocument()
  })

  it('advances to the optional locations step after the admin is created', async () => {
    // Arrange
    const user = userEvent.setup()
    const fake = wizardRoutes()
    renderApp({ fetchFn: fake.fetch, route: '/setup' })
    // Act
    await createAdmin(user)
    // Assert — the second step appears; the account form is gone.
    expect(await screen.findByRole('heading', { name: 'Add your locations' })).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Create the admin account' }),
    ).not.toBeInTheDocument()
  })

  it('lands on the board when "Skip for now" is chosen with zero locations', async () => {
    // Arrange
    const user = userEvent.setup()
    const fake = wizardRoutes()
    renderApp({ fetchFn: fake.fetch, route: '/setup' })
    // Act
    await createAdmin(user)
    await user.click(await screen.findByRole('button', { name: 'Skip for now' }))
    // Assert — the authenticated board is shown; no locations were created.
    expect(await screen.findByText('Fix pump')).toBeInTheDocument()
    expect(fake.calls.some((c) => c.method === 'POST' && c.url === '/api/v1/locations')).toBe(false)
  })

  it('adds a building via POST /locations and renders it in the step', async () => {
    // Arrange
    const user = userEvent.setup()
    const created: Location = { id: uid(300), parentId: null, kind: 'building', name: 'HQ' }
    // The list refetch after the create returns the new building so it renders.
    let locations: Location[] = []
    const fake = wizardRoutes({
      'GET /api/v1/locations': () => locations,
      'POST /api/v1/locations': () => {
        locations = [created]
        return created
      },
    })
    renderApp({ fetchFn: fake.fetch, route: '/setup' })
    await createAdmin(user)
    // Act
    await user.type(await screen.findByRole('textbox', { name: 'Add building' }), 'HQ')
    await user.click(screen.getByRole('button', { name: 'Add building' }))
    // Assert — the POST carried the building, and the tree now shows it.
    expect(fake.lastBody('POST', '/api/v1/locations')).toEqual({
      parentId: null,
      kind: 'building',
      name: 'HQ',
    })
    expect(await screen.findByText('HQ')).toBeInTheDocument()
  })

  it('renames a location inline in the setup step', async () => {
    // Arrange — one building the admin will rename in place (no modal; the label
    // swaps for a field, mirroring the Settings tree but staying in the wizard).
    const user = userEvent.setup()
    const building: Location = { id: uid(310), parentId: null, kind: 'building', name: 'HQ' }
    let locations: Location[] = [building]
    const fake = wizardRoutes({
      'GET /api/v1/locations': () => locations,
      [`PATCH /api/v1/locations/${building.id}`]: () => {
        const renamed = { ...building, name: 'HQ West' }
        locations = [renamed]
        return renamed
      },
    })
    renderApp({ fetchFn: fake.fetch, route: '/setup' })
    await createAdmin(user)
    // Act — open the inline editor, change the name, and save.
    await user.click(await screen.findByLabelText('Rename HQ'))
    const input = await screen.findByRole('textbox', { name: 'New name for HQ' })
    await user.clear(input)
    await user.type(input, 'HQ West')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    // Assert — the PATCH carried the new name and the row now reads it.
    expect(fake.lastBody('PATCH', `/api/v1/locations/${building.id}`)).toEqual({ name: 'HQ West' })
    expect(await screen.findByText('HQ West')).toBeInTheDocument()
  })

  it('shows a friendly inline error when adding a duplicate sibling name in setup', async () => {
    // Arrange — the server rejects the duplicate name with a 409 conflict.
    const user = userEvent.setup()
    const fake = wizardRoutes({
      'GET /api/v1/locations': [],
      'POST /api/v1/locations': () =>
        problemResponse(409, { type: 'urn:rivian-kanban:problem:conflict', title: 'Conflict' }),
    })
    renderApp({ fetchFn: fake.fetch, route: '/setup' })
    await createAdmin(user)
    // Act — try to add a building whose name already exists among siblings.
    await user.type(await screen.findByRole('textbox', { name: 'Add building' }), 'HQ')
    await user.click(screen.getByRole('button', { name: 'Add building' }))
    // Assert — the error shows inline beside the field (not just a toast).
    expect(
      await screen.findByText(
        'Another location here already has this name. Pick a different name.',
      ),
    ).toBeInTheDocument()
  })

  it('confirms before removing a location and warns descendants go too', async () => {
    // Arrange
    const user = userEvent.setup()
    const building: Location = { id: uid(301), parentId: null, kind: 'building', name: 'HQ' }
    const floor: Location = { id: uid(302), parentId: building.id, kind: 'floor', name: 'Floor 1' }
    const fake = wizardRoutes({
      'GET /api/v1/locations': [building, floor],
      [`DELETE /api/v1/locations/${building.id}`]: {},
    })
    renderApp({ fetchFn: fake.fetch, route: '/setup' })
    await createAdmin(user)
    // Act — the remove affordance opens a confirm dialog; no request yet.
    await user.click(await screen.findByLabelText('Remove HQ'))
    const dialog = await screen.findByRole('dialog')
    // Assert — the dialog names the target and warns about descendants.
    expect(dialog).toHaveTextContent('Remove “HQ”?')
    expect(dialog).toHaveTextContent(/floors and rooms/i)
    expect(fake.calls.some((c) => c.method === 'DELETE')).toBe(false)
    // Act — confirming issues the DELETE.
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    // Assert
    expect(fake.calls.some((c) => c.method === 'DELETE')).toBe(true)
  })

  it('lands on the board when "Continue to board" is chosen', async () => {
    // Arrange
    const user = userEvent.setup()
    const fake = wizardRoutes()
    renderApp({ fetchFn: fake.fetch, route: '/setup' })
    // Act
    await createAdmin(user)
    await user.click(await screen.findByRole('button', { name: 'Continue to board' }))
    // Assert
    expect(await screen.findByText('Fix pump')).toBeInTheDocument()
  })
})
