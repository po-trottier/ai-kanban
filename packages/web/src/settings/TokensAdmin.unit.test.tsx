import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { type ServiceTokenView } from '../api/schemas.ts'
import { createFakeFetch } from '../test/fake-fetch.ts'
import { fixtureAdmin, uid } from '../test/fixtures.ts'
import { renderWithProviders } from '../test/render.tsx'
import { TokensAdmin } from './TokensAdmin.tsx'

const activeToken: ServiceTokenView = {
  id: uid(81),
  name: 'reporting-bot',
  role: 'user',
  scope: 'read',
  createdBy: fixtureAdmin.id,
  createdAt: '2026-07-01T10:00:00.000Z',
  lastUsedAt: null,
  revokedAt: null,
}

describe('TokensAdmin', () => {
  it('lists tokens with role, scope, and revocation state', async () => {
    // Arrange
    const revoked: ServiceTokenView = {
      ...activeToken,
      id: uid(82),
      name: 'old-bot',
      revokedAt: '2026-07-02T10:00:00.000Z',
    }
    const fake = createFakeFetch({ 'GET /api/v1/service-tokens': [activeToken, revoked] })
    // Act
    renderWithProviders(<TokensAdmin />, { fetchFn: fake.fetch })
    // Assert
    expect(await screen.findByText('reporting-bot')).toBeInTheDocument()
    expect(screen.getByText('Revoked')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeInTheDocument()
    expect(screen.getAllByText('Never')).toHaveLength(2)
  })

  it('shows an empty state when no tokens exist yet', async () => {
    // Arrange
    const fake = createFakeFetch({ 'GET /api/v1/service-tokens': [] })
    // Act
    renderWithProviders(<TokensAdmin />, { fetchFn: fake.fetch })
    // Assert
    expect(await screen.findByText('No service tokens yet')).toBeInTheDocument()
  })

  it('creates a token and shows the raw rkb_ value exactly once', async () => {
    // Arrange
    const user = userEvent.setup()
    const fake = createFakeFetch({
      'GET /api/v1/service-tokens': [],
      'POST /api/v1/service-tokens': {
        token: activeToken,
        // Built by concatenation so secret scanners never match the fixture.
        rawToken: ['rkb', 'fixture', 'value'].join('_'),
      },
    })
    renderWithProviders(<TokensAdmin />, { fetchFn: fake.fetch })
    // Act
    await user.click(await screen.findByRole('button', { name: 'New token' }))
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'reporting-bot')
    await user.click(screen.getByRole('button', { name: 'Create' }))
    // Assert
    expect(await screen.findByText('rkb_fixture_value')).toBeInTheDocument()
    expect(screen.getByText('Copy this token now — it is shown only once.')).toBeInTheDocument()
    expect(fake.lastBody('POST', '/api/v1/service-tokens')).toEqual({
      name: 'reporting-bot',
      role: 'user',
      scope: 'read',
    })
    // The one-time secret has a 1-click Copy button: it writes the raw token to
    // the clipboard and confirms by flipping its label to "Copied".
    await user.click(screen.getByRole('button', { name: 'Copy' }))
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
    expect(await navigator.clipboard.readText()).toBe('rkb_fixture_value')
  })

  it('revokes a token via DELETE', async () => {
    // Arrange
    const user = userEvent.setup()
    const fake = createFakeFetch({
      'GET /api/v1/service-tokens': [activeToken],
      [`DELETE /api/v1/service-tokens/${activeToken.id}`]: {},
    })
    renderWithProviders(<TokensAdmin />, { fetchFn: fake.fetch })
    // Act — revoking can break a live integration, so it is confirmed first.
    await user.click(await screen.findByRole('button', { name: 'Revoke' }))
    await user.click(await screen.findByRole('button', { name: 'Revoke token' }))
    // Assert
    const call = fake.calls.find((c) => c.method === 'DELETE')
    expect(call?.url).toBe(`/api/v1/service-tokens/${activeToken.id}`)
  })
})
