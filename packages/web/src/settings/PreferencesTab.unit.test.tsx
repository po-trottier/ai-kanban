import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createFakeFetch } from '../test/fake-fetch.ts'
import { fixtureAdmin } from '../test/fixtures.ts'
import { renderWithProviders } from '../test/render.tsx'
import { PreferencesTab } from './PreferencesTab.tsx'

describe('PreferencesTab', () => {
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
