import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createFakeFetch } from '../test/fake-fetch.ts'
import { fixtureAdmin, fixturePickerUsers, fixtureTech, nth } from '../test/fixtures.ts'
import { renderWithProviders } from '../test/render.tsx'
import { UsersAdmin } from './UsersAdmin.tsx'

describe('UsersAdmin', () => {
  it('lists active users with their emails and roles', async () => {
    // Arrange
    const fake = createFakeFetch({ 'GET /api/v1/users': fixturePickerUsers })
    // Act
    renderWithProviders(<UsersAdmin />, { fetchFn: fake.fetch })
    // Assert
    expect(await screen.findByText('Ada Admin')).toBeInTheDocument()
    expect(screen.getByText('tech@example.com')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Role: Terry Tech' })).toHaveValue('User')
  })

  it('creates a user and shows the one-time temp password exactly once', async () => {
    // Arrange
    const user = userEvent.setup()
    const fake = createFakeFetch({
      'GET /api/v1/users': fixturePickerUsers,
      'POST /api/v1/users': { user: fixtureTech, tempPassword: 'temp-secret-123' },
    })
    renderWithProviders(<UsersAdmin />, { fetchFn: fake.fetch })
    // Act
    await user.click(await screen.findByRole('button', { name: 'New user' }))
    await user.type(screen.getByRole('textbox', { name: 'Display name' }), 'New Person')
    await user.type(screen.getByRole('textbox', { name: 'Email' }), 'new@example.com')
    await user.click(screen.getByRole('button', { name: 'Create' }))
    // Assert
    expect(await screen.findByText('temp-secret-123')).toBeInTheDocument()
    expect(fake.lastBody('POST', '/api/v1/users')).toEqual({
      email: 'new@example.com',
      displayName: 'New Person',
      role: 'user',
    })
  })

  it('resets a password and surfaces the returned temp password', async () => {
    // Arrange
    const user = userEvent.setup()
    const fake = createFakeFetch({
      'GET /api/v1/users': fixturePickerUsers,
      [`PATCH /api/v1/users/${fixtureTech.id}`]: { user: fixtureTech, tempPassword: 'reset-pw-9' },
    })
    renderWithProviders(<UsersAdmin />, { fetchFn: fake.fetch })
    // Act
    const buttons = await screen.findAllByRole('button', { name: 'Reset password' })
    await user.click(nth(buttons, 1))
    // Assert
    expect(await screen.findByText('reset-pw-9')).toBeInTheDocument()
    expect(fake.lastBody('PATCH', `/api/v1/users/${fixtureTech.id}`)).toEqual({
      resetPassword: true,
    })
  })

  it('deactivates a user via PATCH isActive false after an explicit confirmation', async () => {
    // Arrange
    const user = userEvent.setup()
    const fake = createFakeFetch({
      'GET /api/v1/users': fixturePickerUsers,
      [`PATCH /api/v1/users/${fixtureAdmin.id}`]: { user: fixtureAdmin },
    })
    renderWithProviders(<UsersAdmin />, { fetchFn: fake.fetch })
    // Act
    const buttons = await screen.findAllByRole('button', { name: 'Deactivate' })
    await user.click(nth(buttons, 0))
    const sentBeforeConfirm = fake.calls.some((c) => c.method === 'PATCH')
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Deactivate' }))
    // Assert — nothing was sent until the modal confirmed (it is one-way in the UI)
    expect(sentBeforeConfirm).toBe(false)
    expect(fake.lastBody('PATCH', `/api/v1/users/${fixtureAdmin.id}`)).toEqual({
      isActive: false,
    })
  })

  it('cancelling the deactivate confirmation sends nothing', async () => {
    // Arrange
    const user = userEvent.setup()
    const fake = createFakeFetch({ 'GET /api/v1/users': fixturePickerUsers })
    renderWithProviders(<UsersAdmin />, { fetchFn: fake.fetch })
    // Act
    const buttons = await screen.findAllByRole('button', { name: 'Deactivate' })
    await user.click(nth(buttons, 0))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    // Assert
    expect(fake.calls.some((c) => c.method === 'PATCH')).toBe(false)
    expect(screen.queryByText('Deactivate user')).not.toBeInTheDocument()
  })
})
