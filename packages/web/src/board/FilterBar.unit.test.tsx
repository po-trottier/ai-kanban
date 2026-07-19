import { EMPTY_BOARD_FILTER, type BoardFilter } from '@rivian-kanban/core'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createFakeFetch, type FakeRouteResult } from '../test/fake-fetch.ts'
import { fixtureAdmin, fixturePickerUsers, fixtureTech, uid } from '../test/fixtures.ts'
import { renderWithProviders } from '../test/render.tsx'
import { FilterBar } from './FilterBar.tsx'

/**
 * The presets combobox fetches on mount, and the assignee/reporter pickers are
 * ASYNC — they hit `GET /users/search` (`?q=` free-text, `?ids=` to resolve the
 * already-selected pills). The fake fetch keys on path only, so one handler
 * splits the two search legs by inspecting the URL's query string.
 */
function userSearchHandler(_init: RequestInit | undefined, url: string): FakeRouteResult {
  const query = new URLSearchParams(url.split('?')[1] ?? '')
  const ids = query.get('ids')
  if (ids !== null) {
    // `?ids=` resolves an explicit set — return exactly the requested users.
    const wanted = new Set(ids.split(','))
    return fixturePickerUsers.filter((user) => wanted.has(user.id))
  }
  // `?q=` free-text: case-insensitive substring over the display name.
  const q = (query.get('q') ?? '').toLowerCase()
  return fixturePickerUsers.filter((user) => user.displayName.toLowerCase().includes(q))
}

const baseRoutes = {
  'GET /api/v1/filter-presets': [],
  'GET /api/v1/users/search': userSearchHandler,
}

function renderBar(filter: BoardFilter = EMPTY_BOARD_FILTER, busy = false) {
  const onChange = vi.fn()
  const fake = createFakeFetch(baseRoutes)
  renderWithProviders(
    <FilterBar
      filter={filter}
      onChange={onChange}
      busy={busy}
      tags={['HVAC', 'urgent']}
      locations={[{ id: uid(300), parentId: null, name: 'Building A', kind: 'building' }]}
      currentUserId={fixtureTech.id}
    />,
    { fetchFn: fake.fetch },
  )
  return { onChange, fake }
}

describe('FilterBar', () => {
  it('shows the filtering progress bar while any filter change is applying', () => {
    // Arrange — the parent marks the bar busy (a filter edit is registered but not
    // yet fetched — the debounce window — or the request is in flight).
    const busy = true
    // Act
    renderBar(EMPTY_BOARD_FILTER, busy)
    // Assert — a "Filtering…" progress bar shows so every filter edit reads as
    // working immediately, rather than the board sitting still for ~300ms.
    expect(screen.getByRole('progressbar', { name: 'Filtering…' })).toBeInTheDocument()
  })

  it('hides the filtering progress bar when idle', () => {
    // Arrange
    const busy = false
    // Act
    renderBar(EMPTY_BOARD_FILTER, busy)
    // Assert
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('adds a priority through the multi-select (any-of) and reports the next filter', async () => {
    // Arrange
    const user = userEvent.setup()
    const { onChange } = renderBar()
    // Act — open the Priority multi-select and pick P0 (options carry the code +
    // plain-language name in their accessible text).
    await user.click(screen.getByRole('combobox', { name: 'Priority' }))
    await user.click(await screen.findByRole('option', { name: /P0 — Critical/ }))
    // Assert — onChange gets the full filter with priorities narrowed to [P0].
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ priorities: ['P0'], scope: 'active' }),
    )
  })

  it('sets the archived scope through the segmented control', async () => {
    // Arrange
    const user = userEvent.setup()
    const { onChange } = renderBar()
    // Act — the scope control is a single-value segmented control.
    await user.click(screen.getByRole('radio', { name: 'Archived' }))
    // Assert
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ scope: 'archived' }))
  })

  it('toggles the overdue facet on', async () => {
    // Arrange
    const user = userEvent.setup()
    const { onChange } = renderBar()
    // Act — the overdue control is a two-segment "Any | Overdue" toggle.
    await user.click(screen.getByRole('radio', { name: 'Overdue' }))
    // Assert
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ overdue: true }))
  })

  it('async-searches the server for an assignee and picks a match', async () => {
    // Arrange
    const user = userEvent.setup()
    const { onChange, fake } = renderBar()
    // Act — open the Assignee picker and TYPE: this queries `/users/search?q=`
    // (never loading the whole roster) and shows the matching option.
    await user.click(screen.getByRole('combobox', { name: 'Assignee' }))
    await user.type(screen.getByRole('combobox', { name: 'Assignee' }), 'Terry')
    // The 275ms debounce fires the `q=Terry` request AFTER typing stops; the
    // option list is meanwhile already populated by the empty-`q` search, so
    // wait for the specific request rather than racing the debounce.
    await waitFor(() => {
      expect(
        fake.calls.some(
          (call) => call.url.includes('/users/search') && call.url.includes('q=Terry'),
        ),
      ).toBe(true)
    })
    await user.click(await screen.findByRole('option', { name: fixtureTech.displayName }))
    // Assert — the pick updated the filter to the matched assignee.
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ assigneeIds: [fixtureTech.id] }),
    )
  })

  it('resolves a pre-selected assignee id to its name via the ids endpoint', async () => {
    // Arrange — a filter with an assignee already selected (its pill must show a
    // NAME even though nothing has been searched: the picker resolves it by id).
    const filter = { ...EMPTY_BOARD_FILTER, assigneeIds: [fixtureAdmin.id] }
    // Act — render the bar with that pre-selected id.
    const { fake } = renderBar(filter)
    // Assert — the resolve leg (`?ids=`) fired and the pill carries the name.
    await waitFor(() => {
      expect(
        fake.calls.some(
          (call) =>
            call.url.includes('/users/search') && call.url.includes(`ids=${fixtureAdmin.id}`),
        ),
      ).toBe(true)
    })
    // The resolved name renders (as the selected pill, and possibly a dropdown
    // option) — a NAME, never the raw id. `findAll` since it can appear twice.
    expect((await screen.findAllByText(fixtureAdmin.displayName)).length).toBeGreaterThan(0)
  })

  it('adds a tag through the multi-select combobox (any-of)', async () => {
    // Arrange
    const user = userEvent.setup()
    const { onChange } = renderBar()
    // Act
    await user.click(screen.getByRole('combobox', { name: 'Tags' }))
    await user.click(await screen.findByRole('option', { name: 'HVAC' }))
    // Assert
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ tags: ['HVAC'] }))
  })

  it('edits the text query', async () => {
    // Arrange
    const user = userEvent.setup()
    const { onChange } = renderBar()
    // Act — the query input is label-less; its accessible name is the aria-label.
    await user.type(screen.getByRole('textbox', { name: 'Filter cards' }), 'p')
    // Assert
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'p' }))
  })

  it('resets every facet to the empty filter with Reset filters', async () => {
    // Arrange — a filter with several facets set.
    const user = userEvent.setup()
    const filter: BoardFilter = {
      ...EMPTY_BOARD_FILTER,
      priorities: ['P0'],
      scope: 'all',
      overdue: true,
      q: 'pump',
    }
    const { onChange } = renderBar(filter)
    // Act — Reset filters is a text button (accessible name from its aria-label).
    await user.click(screen.getByRole('button', { name: 'Reset filters' }))
    // Assert — the empty filter (today's full board).
    expect(onChange).toHaveBeenCalledWith(EMPTY_BOARD_FILTER)
  })

  it('renders a pill for an already-selected facet value', () => {
    // Arrange — a filter with P1 pre-selected.
    const filter = { ...EMPTY_BOARD_FILTER, priorities: ['P1' as const] }
    // Act — render the bar with that filter.
    renderBar(filter)
    // Assert — the Priority multi-select shows a "P1" pill reflecting the filter
    // (the dropdown is closed, so "P1" only appears as the selected pill).
    expect(screen.getByText('P1')).toBeInTheDocument()
  })
})
