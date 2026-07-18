import { EMPTY_BOARD_FILTER, type BoardFilter } from '@rivian-kanban/core'
import { screen, within } from '@testing-library/react'
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
  it('toggles a priority chip on (any-of) and reports the next filter', async () => {
    // Arrange
    const user = userEvent.setup()
    const { onChange } = renderBar()
    const group = screen.getByRole('group', { name: 'Filter by priority' })
    // Act — pick P0.
    await user.click(within(group).getByText('P0'))
    // Assert — onChange gets the full filter with priorities narrowed to [P0].
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ priorities: ['P0'], scope: 'active' }),
    )
  })

  it('toggles a status (lane) chip on', async () => {
    // Arrange
    const user = userEvent.setup()
    const { onChange } = renderBar()
    const group = screen.getByRole('group', { name: 'Filter by status' })
    // Act
    await user.click(within(group).getByText('In Progress'))
    // Assert
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ laneKeys: ['in_progress'] }))
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
    // Act
    await user.type(screen.getByRole('textbox', { name: 'Filter cards' }), 'p')
    // Assert
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'p' }))
  })

  it('resets every facet to the empty filter with Clear filters', async () => {
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
    // Act
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    // Assert — the empty filter (today's full board).
    expect(onChange).toHaveBeenCalledWith(EMPTY_BOARD_FILTER)
  })

  it('shows a checked chip for an already-selected facet value', () => {
    // Arrange — a filter with P1 pre-selected.
    const filter = { ...EMPTY_BOARD_FILTER, priorities: ['P1' as const] }
    // Act — render the bar with that filter.
    renderBar(filter)
    // Assert — the P1 chip's checkbox input is checked (reflects the filter state).
    const group = screen.getByRole('group', { name: 'Filter by priority' })
    expect(within(group).getByRole('checkbox', { name: 'P1' })).toBeChecked()
  })
})
