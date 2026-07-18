import { EMPTY_BOARD_FILTER, type BoardFilter, type FilterPreset } from '@rivian-kanban/core'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createFakeFetch, jsonResponse, type FakeFetch } from '../test/fake-fetch.ts'
import { fixtureTech, uid } from '../test/fixtures.ts'
import { renderWithProviders } from '../test/render.tsx'
import { FilterPresets } from './FilterPresets.tsx'

const ME = fixtureTech.id

/** A custom preset that narrows to P0 + archived scope (the complete filter). */
function customPreset(overrides: Partial<FilterPreset> = {}): FilterPreset {
  return {
    id: uid(600),
    ownerId: ME,
    name: 'Urgent archived',
    filter: { ...EMPTY_BOARD_FILTER, priorities: ['P0'], scope: 'archived' },
    createdAt: '2026-07-10T09:00:00.000Z',
    updatedAt: '2026-07-10T09:00:00.000Z',
    ...overrides,
  }
}

function renderPresets(
  presets: FilterPreset[],
  routes: Record<string, unknown> = {},
  filter: BoardFilter = EMPTY_BOARD_FILTER,
) {
  const onApply = vi.fn()
  const fake: FakeFetch = createFakeFetch({
    'GET /api/v1/filter-presets': presets,
    ...routes,
  })
  renderWithProviders(<FilterPresets filter={filter} onApply={onApply} currentUserId={ME} />, {
    fetchFn: fake.fetch,
  })
  return { onApply, fake }
}

async function pickPreset(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('combobox', { name: 'Preset' }))
  await user.click(await screen.findByRole('option', { name }))
}

describe('FilterPresets', () => {
  it('applies the "My Cards" built-in with the current user filled into assigneeIds', async () => {
    // Arrange
    const user = userEvent.setup()
    const { onApply } = renderPresets([])
    // Act
    await pickPreset(user, 'My Cards')
    // Assert — the COMPLETE filter, with the current user id filled client-side.
    expect(onApply).toHaveBeenCalledWith({ ...EMPTY_BOARD_FILTER, assigneeIds: [ME] })
  })

  it('applies the "Overdue" built-in (overdue:true, everything else empty)', async () => {
    // Arrange
    const user = userEvent.setup()
    const { onApply } = renderPresets([])
    // Act
    await pickPreset(user, 'Overdue')
    // Assert
    expect(onApply).toHaveBeenCalledWith({ ...EMPTY_BOARD_FILTER, overdue: true })
  })

  it('applies a custom preset as the COMPLETE saved filter (every facet)', async () => {
    // Arrange
    const preset = customPreset()
    const user = userEvent.setup()
    const { onApply } = renderPresets([preset])
    // Act
    await pickPreset(user, preset.name)
    // Assert — the whole saved filter is applied, not an overlay.
    expect(onApply).toHaveBeenCalledWith(preset.filter)
  })

  it('hides the rename/delete affordances once the live filter drifts from the applied preset', async () => {
    // Arrange — the bar's live filter has drifted from the preset (as it does
    // after an edit or "Clear filters"), so the combobox reflects NO selection
    // even after a pick — which is what lets re-picking the same option re-fire
    // onApply (Mantine's Select no-ops on re-selecting the already-current value).
    const preset = customPreset()
    const user = userEvent.setup()
    renderPresets([preset], {}, EMPTY_BOARD_FILTER)
    // Act — pick the preset while the live filter does not match it.
    await pickPreset(user, preset.name)
    // Assert — no selection is shown, so the delete affordance never appears.
    expect(screen.queryByRole('button', { name: 'Delete this preset' })).not.toBeInTheDocument()
  })

  it('saves the current filter as a new named preset (POST)', async () => {
    // Arrange — the bar holds a non-empty filter to save.
    const user = userEvent.setup()
    const filter: BoardFilter = { ...EMPTY_BOARD_FILTER, priorities: ['P1'], q: 'boiler' }
    const created = customPreset({ id: uid(601), name: 'Boiler P1', filter })
    const { fake } = renderPresets(
      [],
      { 'POST /api/v1/filter-presets': jsonResponse(created, 201) },
      filter,
    )
    // Act — open the save dialog, name it, confirm.
    await user.click(screen.getByRole('button', { name: 'Save current filters as a preset' }))
    await user.type(screen.getByRole('textbox', { name: 'Preset name' }), 'Boiler P1')
    await user.click(screen.getByRole('button', { name: 'Save preset' }))
    // Assert — the POST body carries the name + the current filter, and a toast fires.
    expect(await screen.findByText('Preset saved')).toBeInTheDocument()
    expect(fake.lastBody('POST', '/api/v1/filter-presets')).toEqual({ name: 'Boiler P1', filter })
  })

  it('disables Save until a name is entered', async () => {
    // Arrange
    const user = userEvent.setup()
    renderPresets([])
    // Act
    await user.click(screen.getByRole('button', { name: 'Save current filters as a preset' }))
    // Assert — the confirm button is shown disabled (data-disabled) with a reason.
    expect(screen.getByRole('button', { name: 'Save preset' })).toHaveAttribute('data-disabled')
  })

  it('renames the selected custom preset (PATCH)', async () => {
    // Arrange
    const preset = customPreset()
    const user = userEvent.setup()
    // The bar's live filter equals the preset's (as it does once applied), so the
    // combobox stays selected and the rename/delete affordances show.
    const { fake } = renderPresets(
      [preset],
      {
        [`PATCH /api/v1/filter-presets/${preset.id}`]: jsonResponse({
          ...preset,
          name: 'Renamed',
        }),
      },
      preset.filter,
    )
    // Select it so the rename affordance appears.
    await pickPreset(user, preset.name)
    // Act
    await user.click(screen.getByRole('button', { name: 'Rename this preset' }))
    const field = screen.getByRole('textbox', { name: 'Preset name' })
    await user.clear(field)
    await user.type(field, 'Renamed')
    await user.click(screen.getByRole('button', { name: 'Rename' }))
    // Assert
    expect(await screen.findByText('Preset renamed')).toBeInTheDocument()
    expect(fake.lastBody('PATCH', `/api/v1/filter-presets/${preset.id}`)).toEqual({
      name: 'Renamed',
    })
  })

  it('deletes the selected custom preset (DELETE)', async () => {
    // Arrange
    const preset = customPreset()
    const user = userEvent.setup()
    // The live filter equals the preset's (the applied state), so it stays selected.
    const { fake } = renderPresets(
      [preset],
      {
        [`DELETE /api/v1/filter-presets/${preset.id}`]: jsonResponse(null, 204),
      },
      preset.filter,
    )
    await pickPreset(user, preset.name)
    // Act
    await user.click(screen.getByRole('button', { name: 'Delete this preset' }))
    // Assert
    expect(await screen.findByText('Preset deleted')).toBeInTheDocument()
    expect(
      fake.calls.some(
        (call) => call.method === 'DELETE' && call.url === `/api/v1/filter-presets/${preset.id}`,
      ),
    ).toBe(true)
  })
})
