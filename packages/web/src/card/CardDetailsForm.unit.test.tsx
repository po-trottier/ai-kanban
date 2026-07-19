import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { type CardDetailResponse } from '../api/schemas.ts'
import { createFakeFetch, type FakeRouteResult } from '../test/fake-fetch.ts'
import { fixturePickerUsers, makeCard, uid } from '../test/fixtures.ts'
import { renderWithProviders } from '../test/render.tsx'
import { CardDetailsForm, type CardFieldChanges } from './CardDetailsForm.tsx'

/**
 * The Assignee picker searches (`?q=`) and the read-only Reporter resolves its
 * id to a name (`?ids=`) — both hit `GET /users/search`. One handler splits the
 * legs by query string, so a pre-populated reporter still renders its name.
 */
function userSearchHandler(_init: RequestInit | undefined, url: string): FakeRouteResult {
  const query = new URLSearchParams(url.split('?')[1] ?? '')
  const ids = query.get('ids')
  if (ids !== null) {
    const wanted = new Set(ids.split(','))
    return fixturePickerUsers.filter((user) => wanted.has(user.id))
  }
  const q = (query.get('q') ?? '').toLowerCase()
  return fixturePickerUsers.filter((user) => user.displayName.toLowerCase().includes(q))
}

const userSearchRoutes = { 'GET /api/v1/users/search': userSearchHandler }

function makeDetail(): CardDetailResponse {
  return {
    card: makeCard('ready', { title: 'Fix pump', description: 'It leaks' }),
    tags: [{ id: uid(71), name: 'plumbing' }],
    location: null,
    attachments: [],
  }
}

function renderForm(props: Partial<Parameters<typeof CardDetailsForm>[0]> = {}) {
  const fake = createFakeFetch(userSearchRoutes)
  renderWithProviders(
    <CardDetailsForm
      detail={makeDetail()}
      locations={[]}
      knownTags={[]}
      saving={false}
      onSave={() => undefined}
      {...props}
    />,
    { fetchFn: fake.fetch },
  )
  return fake
}

/** Swaps the detail prop like a TanStack refetch would (SSE hint, upload). */
function RefetchHarness({
  initial,
  refreshed,
}: {
  initial: CardDetailResponse
  refreshed: CardDetailResponse
}) {
  const [detail, setDetail] = useState(initial)
  return (
    <>
      <CardDetailsForm
        detail={detail}
        locations={[]}
        knownTags={[]}
        saving={false}
        onSave={() => undefined}
      />
      <button
        type="button"
        onClick={() => {
          setDetail(refreshed)
        }}
      >
        refetch
      </button>
    </>
  )
}

describe('CardDetailsForm', () => {
  it('rejects clearing the title (core schema validation)', async () => {
    // Arrange
    const user = userEvent.setup()
    const saved: CardFieldChanges[] = []
    renderForm({ onSave: (changes) => saved.push(changes) })
    // Act
    await user.clear(screen.getByRole('textbox', { name: /Title/ }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    // Assert
    expect(saved).toEqual([])
    expect(screen.getByRole('textbox', { name: /Title/ })).toBeInvalid()
  })

  it('keeps Save disabled until a field is edited', () => {
    // Arrange
    // Act
    renderForm()
    // Assert — the Save button shows disabled via `data-disabled` (so its
    // "nothing to save" tooltip stays hoverable), not the native disabled prop.
    expect(screen.getByRole('button', { name: 'Save changes' })).toHaveAttribute(
      'data-disabled',
      'true',
    )
  })

  it('submits only the dirty fields (one audit event per real change)', async () => {
    // Arrange
    const user = userEvent.setup()
    const saved: CardFieldChanges[] = []
    renderForm({ onSave: (changes) => saved.push(changes) })
    // Act
    const title = screen.getByRole('textbox', { name: /Title/ })
    await user.clear(title)
    await user.type(title, 'Replace pump seal')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    // Assert
    expect(saved).toEqual([{ title: 'Replace pump seal' }])
  })

  it('keeps in-progress edits and updates untouched fields on a server refetch', async () => {
    // Arrange — the user is mid-edit on the title when new server state lands
    const user = userEvent.setup()
    const initial = makeDetail()
    const refreshed: CardDetailResponse = {
      ...initial,
      card: { ...initial.card, estimateMinutes: 90, version: 5 },
    }
    const fake = createFakeFetch(userSearchRoutes)
    renderWithProviders(<RefetchHarness initial={initial} refreshed={refreshed} />, {
      fetchFn: fake.fetch,
    })
    const title = screen.getByRole('textbox', { name: /Title/ })
    await user.clear(title)
    await user.type(title, 'Replace pump seal')
    // Act — an SSE hint / attachment upload refetches the card detail
    await user.click(screen.getByRole('button', { name: 'refetch' }))
    // Assert — the draft survives; the untouched estimate takes the server value
    expect(screen.getByRole('textbox', { name: /Title/ })).toHaveValue('Replace pump seal')
    expect(screen.getByRole('textbox', { name: /Estimate/ })).toHaveValue('90')
  })

  it('auto-saves the edited field and hides Save in create view (autoSave)', async () => {
    // Arrange — the create view has no Save button; a debounced watcher PATCHes
    // edited fields on its own (the draft card already exists).
    const user = userEvent.setup()
    const saved: CardFieldChanges[] = []
    renderForm({ autoSave: true, onSave: (changes) => saved.push(changes) })
    // Assert — no explicit Save in create view.
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
    // Act — edit only the title.
    const title = screen.getByRole('textbox', { name: /Title/ })
    await user.clear(title)
    await user.type(title, 'Broken door')
    // Assert — the debounced save sent ONLY the dirty subset, unprompted.
    await waitFor(
      () => {
        expect(saved.at(-1)).toEqual({ title: 'Broken door' })
      },
      { timeout: 2000 },
    )
  })

  it('renders every field disabled and hides Save when the card is read-only', () => {
    // Arrange
    // Act
    renderForm({ disabled: true })
    // Assert
    expect(screen.getByRole('textbox', { name: /Title/ })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
  })

  it('resolves the read-only reporter id to its name and both datetimes', async () => {
    // Arrange — a distinct updatedAt proves the Updated row reads the right field.
    const detail = makeDetail()
    detail.card.updatedAt = '2026-07-05T18:30:00.000Z'
    // Act
    renderForm({ detail })
    // Assert — Reporter looks EXACTLY like Assignee: a combobox directly below
    // it, but disabled and resolved (via `?ids=`) to the card's reporter (Ada
    // Admin); Assignee stays an enabled combobox.
    const reporterField = screen.getByRole('combobox', { name: 'Reporter' })
    expect(reporterField).toBeDisabled()
    expect(await screen.findByDisplayValue('Ada Admin')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Assignee' })).toBeEnabled()
    // Both datetimes render in the viewer's zone (America/Los_Angeles): the
    // created T0 (10:00Z → 03:00) and the distinct updatedAt (18:30Z → 11:30).
    expect(screen.getByText(/Created: Jul 1, 2026 03:00/)).toBeInTheDocument()
    expect(screen.getByText(/Updated: Jul 5, 2026 11:30/)).toBeInTheDocument()
  })

  it('rejects a non-positive estimate (core schema validation)', async () => {
    // Arrange
    const user = userEvent.setup()
    const saved: CardFieldChanges[] = []
    renderForm({ onSave: (changes) => saved.push(changes) })
    // Act
    const estimate = screen.getByRole('textbox', { name: /Estimate/ })
    await user.type(estimate, '0')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    // Assert
    expect(saved).toEqual([])
  })

  it('explains the fields with an info tooltip on the label', () => {
    // Arrange
    // Act — render the form; priority, estimate, location, and the description
    // editor each carry a FieldLabel info button whose accessible name is the
    // help text.
    renderForm()
    // Assert — the info buttons are reachable by their help copy.
    expect(screen.getByRole('button', { name: /P0 Critical/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /target completion time/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /building, floor, or room/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /full details of the work/ })).toBeInTheDocument()
  })
})
