import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createFakeFetch } from '../test/fake-fetch.ts'
import { fixtureAdmin } from '../test/fixtures.ts'
import { renderWithProviders } from '../test/render.tsx'
import { ProfileSettingsModal } from './ProfileSettingsModal.tsx'

describe('ProfileSettingsModal', () => {
  it('seeds the current zone and saves a newly picked one via PATCH /auth/me', async () => {
    // Arrange — fixtureAdmin defaults to PST; the PATCH returns the updated user.
    const user = userEvent.setup()
    const fake = createFakeFetch({
      'PATCH /api/v1/auth/me': { ...fixtureAdmin, timezone: 'America/New_York' },
    })
    let closed = false
    renderWithProviders(
      <ProfileSettingsModal
        onClose={() => {
          closed = true
        }}
      />,
      { fetchFn: fake.fetch },
    )

    // Assert — the picker is seeded from the signed-in user (PST).
    const combo = screen.getByRole('combobox', { name: 'Time zone' })
    expect(combo).toHaveValue('America/Los Angeles')

    // Act — filter to a different zone, pick it, and save.
    await user.click(combo)
    await user.clear(combo)
    await user.type(combo, 'New York')
    await user.click(await screen.findByRole('option', { name: 'America/New York' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    // Assert — the PATCH carried the canonical IANA id and the modal closed.
    expect(fake.lastBody('PATCH', '/api/v1/auth/me')).toEqual({ timezone: 'America/New_York' })
    expect(closed).toBe(true)
  })
})
