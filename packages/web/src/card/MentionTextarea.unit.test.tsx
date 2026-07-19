import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { createFakeFetch, type FakeRouteResult } from '../test/fake-fetch.ts'
import { fixturePickerUsers, fixtureTech } from '../test/fixtures.ts'
import { type PickerUser } from '../api/schemas.ts'
import { renderWithProviders } from '../test/render.tsx'
import { MentionTextarea } from './MentionTextarea.tsx'

/** The @-picker hits `GET /users/search?q=` — case-insensitive over the name. */
function userSearchHandler(_init: RequestInit | undefined, url: string): FakeRouteResult {
  const q = (new URLSearchParams(url.split('?')[1] ?? '').get('q') ?? '').toLowerCase()
  return fixturePickerUsers.filter((user) => user.displayName.toLowerCase().includes(q))
}

/** The textarea is controlled, so a tiny stateful host mirrors the real composer. */
function Harness({ onMention }: { onMention: (user: PickerUser) => void }) {
  const [value, setValue] = useState('')
  return (
    <MentionTextarea aria-label="Comment" value={value} onChange={setValue} onMention={onMention} />
  )
}

describe('MentionTextarea', () => {
  it('opens an async user dropdown while typing @ and inserts the picked mention', async () => {
    // Arrange
    const user = userEvent.setup()
    const onMention = vi.fn()
    const fake = createFakeFetch({ 'GET /api/v1/users/search': userSearchHandler })
    renderWithProviders(<Harness onMention={onMention} />, { fetchFn: fake.fetch })
    // Act — type an @-mention; the async search surfaces the matching user.
    const textarea = screen.getByRole('textbox', { name: 'Comment' })
    await user.click(textarea)
    await user.type(textarea, 'Hey @Terry')
    await user.click(await screen.findByRole('option', { name: fixtureTech.displayName }))
    // Assert — the mention text is inserted at the cursor and the user reported.
    expect(onMention).toHaveBeenCalledWith(
      expect.objectContaining({ id: fixtureTech.id, displayName: fixtureTech.displayName }),
    )
    expect(textarea).toHaveValue(`Hey @${fixtureTech.displayName} `)
  })

  it('does not search until an @-token is being typed', async () => {
    // Arrange
    const user = userEvent.setup()
    const fake = createFakeFetch({ 'GET /api/v1/users/search': userSearchHandler })
    renderWithProviders(<Harness onMention={vi.fn()} />, { fetchFn: fake.fetch })
    // Act — plain text, no `@`.
    await user.type(screen.getByRole('textbox', { name: 'Comment' }), 'just a comment')
    // Assert — the user-search endpoint was never hit.
    expect(fake.calls.some((call) => call.url.includes('/users/search'))).toBe(false)
  })
})
