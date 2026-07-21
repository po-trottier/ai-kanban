import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFakeFetch, problemResponse } from '../test/fake-fetch.ts'
import { fixtureAdmin } from '../test/fixtures.ts'
import { renderWithProviders } from '../test/render.tsx'
import { LoginPage } from './LoginPage.tsx'

/** The first-boot probe resolves "no setup needed" — the normal steady state. */
const setupComplete = { 'GET /api/v1/setup': { required: false } }

describe('LoginPage', () => {
  afterEach(() => {
    // Restore the jsdom URL each test mutates for the returnTo cases.
    window.history.replaceState({}, '', '/')
    vi.restoreAllMocks()
  })

  it('carries the product branding above the sign-in heading', async () => {
    // Arrange
    const fake = createFakeFetch({ ...setupComplete })
    // Act
    renderWithProviders(<LoginPage />, { fetchFn: fake.fetch })
    // Assert
    expect(await screen.findByRole('heading', { name: 'Facilities Kanban' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('validates the email and password before submitting', async () => {
    // Arrange
    const user = userEvent.setup()
    const fake = createFakeFetch({ ...setupComplete })
    renderWithProviders(<LoginPage />, { fetchFn: fake.fetch })
    // Act
    await user.type(await screen.findByRole('textbox', { name: 'Email' }), 'not-an-email')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    // Assert
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument()
    expect(await screen.findByText('Enter your password')).toBeInTheDocument()
    expect(fake.calls.filter((call) => call.method === 'POST')).toHaveLength(0)
  })

  it('posts the credentials to /auth/login on a valid submit', async () => {
    // Arrange
    const user = userEvent.setup()
    const fake = createFakeFetch({ ...setupComplete, 'POST /api/v1/auth/login': fixtureAdmin })
    renderWithProviders(<LoginPage />, { fetchFn: fake.fetch })
    // Act
    await user.type(await screen.findByRole('textbox', { name: 'Email' }), 'admin@example.com')
    await user.type(screen.getByLabelText('Password'), 'hunter2hunter2')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    // Assert
    expect(fake.lastBody('POST', '/api/v1/auth/login')).toEqual({
      email: 'admin@example.com',
      password: 'hunter2hunter2',
    })
  })

  it('maps a 401 to a friendly message instead of the raw problem title', async () => {
    // Arrange
    const user = userEvent.setup()
    const fake = createFakeFetch({
      ...setupComplete,
      'POST /api/v1/auth/login': () => problemResponse(401, { title: 'Unauthorized' }),
    })
    renderWithProviders(<LoginPage />, { fetchFn: fake.fetch })
    // Act
    await user.type(await screen.findByRole('textbox', { name: 'Email' }), 'admin@example.com')
    await user.type(screen.getByLabelText('Password'), 'wrong-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    // Assert — the machine-y "Unauthorized" is replaced with plain guidance.
    expect(await screen.findByText('That email or password is not correct.')).toBeInTheDocument()
    expect(screen.queryByText('Unauthorized')).not.toBeInTheDocument()
  })

  it('offers a self-service help path for a forgotten password', async () => {
    // Arrange — the setup probe must resolve so the form (not the loader) renders.
    const fake = createFakeFetch({ ...setupComplete })
    // Act
    renderWithProviders(<LoginPage />, { fetchFn: fake.fetch })
    // Assert
    expect(await screen.findByText(/Ask an admin to reset it/)).toBeInTheDocument()
  })

  it('hard-navigates to a same-origin /oauth/authorize returnTo after login', async () => {
    // Arrange — the OAuth login hop lands here with an absolute authorize URL.
    const returnTo = `${window.location.origin}/oauth/authorize?client_id=c&state=xyz`
    window.history.replaceState({}, '', `/login?returnTo=${encodeURIComponent(returnTo)}`)
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined)
    const user = userEvent.setup()
    const fake = createFakeFetch({ ...setupComplete, 'POST /api/v1/auth/login': fixtureAdmin })
    renderWithProviders(<LoginPage />, { fetchFn: fake.fetch })
    // Act
    await user.type(await screen.findByRole('textbox', { name: 'Email' }), 'admin@example.com')
    await user.type(screen.getByLabelText('Password'), 'hunter2hunter2')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    // Assert — the browser is sent to the exact server route, not react-router.
    await vi.waitFor(() => {
      expect(assign).toHaveBeenCalledWith(returnTo)
    })
  })

  it('ignores a hostile (cross-origin) returnTo — open-redirect guard', async () => {
    // Arrange — an attacker-supplied off-site returnTo must never be honored.
    window.history.replaceState(
      {},
      '',
      `/login?returnTo=${encodeURIComponent('https://evil.example/oauth/authorize')}`,
    )
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined)
    const user = userEvent.setup()
    const fake = createFakeFetch({ ...setupComplete, 'POST /api/v1/auth/login': fixtureAdmin })
    renderWithProviders(<LoginPage />, { fetchFn: fake.fetch })
    // Act
    await user.type(await screen.findByRole('textbox', { name: 'Email' }), 'admin@example.com')
    await user.type(screen.getByLabelText('Password'), 'hunter2hunter2')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    // Assert — the POST fired, but no cross-origin navigation happened.
    await vi.waitFor(() => {
      expect(fake.calls.some((call) => call.method === 'POST')).toBe(true)
    })
    expect(assign).not.toHaveBeenCalled()
  })
})
