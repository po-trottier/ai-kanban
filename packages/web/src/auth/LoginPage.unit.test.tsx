import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createFakeFetch, problemResponse } from '../test/fake-fetch.ts'
import { fixtureAdmin } from '../test/fixtures.ts'
import { renderWithProviders } from '../test/render.tsx'
import { LoginPage } from './LoginPage.tsx'

describe('LoginPage', () => {
  it('carries the product branding above the sign-in heading', () => {
    // Arrange
    const fake = createFakeFetch({})
    // Act
    renderWithProviders(<LoginPage />, { fetchFn: fake.fetch })
    // Assert
    expect(screen.getByRole('heading', { name: 'Facilities Kanban' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('validates the email and password before submitting', async () => {
    // Arrange
    const user = userEvent.setup()
    const fake = createFakeFetch({})
    renderWithProviders(<LoginPage />, { fetchFn: fake.fetch })
    // Act
    await user.type(screen.getByRole('textbox', { name: 'Email' }), 'not-an-email')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    // Assert
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument()
    expect(await screen.findByText('Enter your password')).toBeInTheDocument()
    expect(fake.calls).toHaveLength(0)
  })

  it('posts the credentials to /auth/login on a valid submit', async () => {
    // Arrange
    const user = userEvent.setup()
    const fake = createFakeFetch({ 'POST /api/v1/auth/login': fixtureAdmin })
    renderWithProviders(<LoginPage />, { fetchFn: fake.fetch })
    // Act
    await user.type(screen.getByRole('textbox', { name: 'Email' }), 'admin@example.com')
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
      'POST /api/v1/auth/login': () => problemResponse(401, { title: 'Unauthorized' }),
    })
    renderWithProviders(<LoginPage />, { fetchFn: fake.fetch })
    // Act
    await user.type(screen.getByRole('textbox', { name: 'Email' }), 'admin@example.com')
    await user.type(screen.getByLabelText('Password'), 'wrong-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    // Assert — the machine-y "Unauthorized" is replaced with plain guidance.
    expect(await screen.findByText('That email or password is not correct.')).toBeInTheDocument()
    expect(screen.queryByText('Unauthorized')).not.toBeInTheDocument()
  })

  it('offers a self-service help path for a forgotten password', () => {
    // Arrange
    const fake = createFakeFetch({})
    // Act
    renderWithProviders(<LoginPage />, { fetchFn: fake.fetch })
    // Assert
    expect(screen.getByText(/Ask an admin to reset it/)).toBeInTheDocument()
  })
})
