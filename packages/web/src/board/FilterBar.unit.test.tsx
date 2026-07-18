import { EMPTY_BOARD_FILTER, type BoardFilter } from '@rivian-kanban/core'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createFakeFetch } from '../test/fake-fetch.ts'
import { fixturePickerUsers, fixtureTech, uid } from '../test/fixtures.ts'
import { renderWithProviders } from '../test/render.tsx'
import { FilterBar } from './FilterBar.tsx'

/** The presets combobox inside the bar fetches on mount; give it an empty list. */
const presetRoutes = { 'GET /api/v1/filter-presets': [] }

function renderBar(filter: BoardFilter = EMPTY_BOARD_FILTER) {
  const onChange = vi.fn()
  const fake = createFakeFetch(presetRoutes)
  renderWithProviders(
    <FilterBar
      filter={filter}
      onChange={onChange}
      users={fixturePickerUsers}
      tags={['HVAC', 'urgent']}
      locations={[{ id: uid(300), parentId: null, name: 'Building A', kind: 'building' }]}
      currentUserId={fixtureTech.id}
    />,
    { fetchFn: fake.fetch },
  )
  return { onChange }
}

describe('FilterBar', () => {
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

  it('adds an assignee through the multi-select combobox', async () => {
    // Arrange
    const user = userEvent.setup()
    const { onChange } = renderBar()
    // Act — open the Assignee multi-select and pick a user.
    await user.click(screen.getByRole('combobox', { name: 'Assignee' }))
    await user.click(await screen.findByRole('option', { name: fixtureTech.displayName }))
    // Assert
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ assigneeIds: [fixtureTech.id] }),
    )
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
