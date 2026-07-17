import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createFakeFetch, problemResponse } from '../test/fake-fetch.ts'
import { fixtureAdmin } from '../test/fixtures.ts'
import { renderWithProviders } from '../test/render.tsx'
import { SetupPage } from './SetupPage.tsx'

/** The first-boot state: the database has no users yet. */
const setupRequired = { 'GET /api/v1/setup': { required: true } }

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
})
