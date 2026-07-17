import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createFakeFetch } from '../test/fake-fetch.ts'
import { renderWithProviders } from '../test/render.tsx'
import { ChangePasswordPage } from './ChangePasswordPage.tsx'

describe('ChangePasswordPage', () => {
  it('rejects a short or mismatched new password before submitting', async () => {
    // Arrange
    const user = userEvent.setup()
    const fake = createFakeFetch({})
    renderWithProviders(<ChangePasswordPage />, { fetchFn: fake.fetch })
    // Act
    await user.type(screen.getByLabelText('Current password'), 'old-password')
    await user.type(screen.getByLabelText('New password'), 'short')
    await user.type(screen.getByLabelText('Confirm new password'), 'different')
    await user.click(screen.getByRole('button', { name: 'Change password' }))
    // Assert
    expect(await screen.findByText('Password must be at least 12 characters')).toBeInTheDocument()
    expect(fake.calls).toHaveLength(0)
  })

  it('posts current and new password on a valid submit (revokes other sessions)', async () => {
    // Arrange
    const user = userEvent.setup()
    const fake = createFakeFetch({
      'POST /api/v1/auth/change-password': {},
      'GET /api/v1/auth/me': null,
    })
    renderWithProviders(<ChangePasswordPage />, { fetchFn: fake.fetch })
    // Act
    await user.type(screen.getByLabelText('Current password'), 'temp-password-1')
    await user.type(screen.getByLabelText('New password'), 'brand-new-password-42')
    await user.type(screen.getByLabelText('Confirm new password'), 'brand-new-password-42')
    await user.click(screen.getByRole('button', { name: 'Change password' }))
    // Assert
    expect(fake.lastBody('POST', '/api/v1/auth/change-password')).toEqual({
      currentPassword: 'temp-password-1',
      newPassword: 'brand-new-password-42',
    })
  })
})
