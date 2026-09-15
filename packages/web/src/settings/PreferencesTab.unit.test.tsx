import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createFakeFetch } from '../test/fake-fetch.ts'
import { fixtureAdmin } from '../test/fixtures.ts'
import { renderWithProviders } from '../test/render.tsx'
import { PreferencesTab } from './PreferencesTab.tsx'

describe('PreferencesTab', () => {
  it('shows the running build and refreshes it after a deployment', async () => {
    // Arrange — the server build changes between requests.
    const user = userEvent.setup()
    let version = '1.0.3'
    const fake = createFakeFetch({
      'GET /version': () => ({ version, gitSha: 'abc1234', builtAt: '2026-09-15T03:16:11Z' }),
    })
    renderWithProviders(<PreferencesTab />, { fetchFn: fake.fetch })
    expect(await screen.findByText('1.0.3')).toBeInTheDocument()
    expect(screen.getByText('abc1234')).toBeInTheDocument()
    version = '1.0.4'
    // Act — explicitly verify the deployment.
    await user.click(screen.getByRole('button', { name: 'Refresh version' }))
    // Assert — fresh server identity, bypassing browser cache.
    expect(await screen.findByText('1.0.4')).toBeInTheDocument()
    expect(
      fake.calls
        .filter((call) => call.url === '/version')
        .every((call) => call.init?.cache === 'no-store'),
    ).toBe(true)
  })

  it('shows an error instead of stale build details when refresh fails', async () => {
    // Arrange — a development build followed by an unavailable server.
    const user = userEvent.setup()
    let failed = false
    const fake = createFakeFetch({
      'GET /version': () =>
        failed
          ? new Response('Unavailable', { status: 503 })
          : { version: 'dev', gitSha: 'dev', builtAt: 'dev' },
    })
    renderWithProviders(<PreferencesTab />, { fetchFn: fake.fetch })
    expect(await screen.findByText('Development build')).toBeInTheDocument()
    failed = true
    // Act — refresh while the server is unavailable.
    await user.click(screen.getByRole('button', { name: 'Refresh version' }))
    // Assert — no stale version is presented as current.
    expect(
      await screen.findByText('Unable to load the running version. Try refreshing.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Development build')).not.toBeInTheDocument()
  })

  it('seeds the current zone + theme and saves newly picked ones via PATCH /auth/me', async () => {
    // Arrange — fixtureAdmin defaults to PST + system theme; the PATCH echoes the update.
    const user = userEvent.setup()
    const fake = createFakeFetch({
      'PATCH /api/v1/auth/me': { ...fixtureAdmin, timezone: 'America/New_York', theme: 'dark' },
    })
    renderWithProviders(<PreferencesTab />, { fetchFn: fake.fetch })

    // Assert — the picker is seeded from the signed-in user (PST) and the theme
    // control offers all three modes (System is the seeded selection).
    const combo = screen.getByRole('combobox', { name: 'Time zone' })
    expect(combo).toHaveValue('America/Los Angeles')
    expect(screen.getByRole('radio', { name: 'System' })).toBeChecked()

    // Act — pick a different zone, switch the theme to Dark, and save.
    await user.click(combo)
    await user.clear(combo)
    await user.type(combo, 'New York')
    await user.click(await screen.findByRole('option', { name: 'America/New York' }))
    await user.click(screen.getByRole('radio', { name: 'Dark' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    // Assert — the PATCH carried both display prefs and the success toast shows.
    expect(fake.lastBody('PATCH', '/api/v1/auth/me')).toEqual({
      timezone: 'America/New_York',
      theme: 'dark',
    })
    expect(await screen.findByText('Preferences saved')).toBeInTheDocument()
  })
})
