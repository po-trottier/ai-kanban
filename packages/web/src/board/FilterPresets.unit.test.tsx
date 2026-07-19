import { EMPTY_BOARD_FILTER, type BoardFilter, type FilterPreset } from '@rivian-kanban/core'
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, useState } from 'react'
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
    shared: false,
    createdAt: '2026-07-10T09:00:00.000Z',
    updatedAt: '2026-07-10T09:00:00.000Z',
    ...overrides,
  }
}

/**
 * Stateful wrapper mirroring how the bar drives FilterPresets: `filter` lives in
 * parent state, `onApply` replaces it, and `driftRef` exposes an external setter
 * so a test can simulate a facet edit (the drift #120 must reflect as "Custom").
 */
function StatefulPresets({
  initial,
  onApply,
  onSetterReady,
}: {
  initial: BoardFilter
  onApply: (next: BoardFilter) => void
  onSetterReady: (set: (next: BoardFilter) => void) => void
}) {
  const [filter, setFilter] = useState(initial)
  // Hand the setter to the test's `drift()` helper via a callback (calling a
  // function prop in an effect — no prop mutation, so react-hooks is satisfied).
  useEffect(() => {
    onSetterReady(setFilter)
  }, [onSetterReady])
  return (
    <FilterPresets
      filter={filter}
      onApply={(next) => {
        setFilter(next)
        onApply(next)
      }}
      currentUserId={ME}
    />
  )
}

function renderPresets(
  presets: FilterPreset[],
  routes: Record<string, unknown> = {},
  filter: BoardFilter = EMPTY_BOARD_FILTER,
) {
  const onApply = vi.fn()
  let setFilter: ((next: BoardFilter) => void) | undefined
  const fake: FakeFetch = createFakeFetch({
    'GET /api/v1/filter-presets': presets,
    ...routes,
  })
  renderWithProviders(
    <StatefulPresets
      initial={filter}
      onApply={onApply}
      onSetterReady={(set) => {
        setFilter = set
      }}
    />,
    { fetchFn: fake.fetch },
  )
  // Simulate an external facet edit (the bar mutating the filter after apply).
  const drift = (next: BoardFilter) => {
    act(() => setFilter?.(next))
  }
  return { onApply, fake, drift }
}

async function pickPreset(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('combobox', { name: 'Preset' }))
  await user.click(await screen.findByRole('option', { name }))
}

/** Opens the presets dropdown and selects the trailing "Save preset" entry,
 *  which opens the save-preset dialog (no separate Save icon button). */
async function openCreatePreset(user: ReturnType<typeof userEvent.setup>) {
  await pickPreset(user, 'Save preset')
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

  it('opens the save dialog from the dropdown "Save preset" entry without applying a filter', async () => {
    // Arrange — no separate Save icon button exists any more.
    const user = userEvent.setup()
    const { onApply } = renderPresets([])
    expect(
      screen.queryByRole('button', { name: 'Save current filters as a preset' }),
    ).not.toBeInTheDocument()
    // Act — pick the trailing "Save preset" entry.
    await openCreatePreset(user)
    // Assert — the save dialog opens; selecting the action never applies a filter.
    expect(screen.getByRole('textbox', { name: 'Preset name' })).toBeInTheDocument()
    expect(onApply).not.toHaveBeenCalled()
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
    // Arrange — apply a custom preset (matches: affordances show)…
    const preset = customPreset()
    const user = userEvent.setup()
    const { drift } = renderPresets([preset], {}, preset.filter)
    await pickPreset(user, preset.name)
    expect(screen.getByRole('button', { name: 'Delete this preset' })).toBeInTheDocument()
    // Act — a facet edit drifts the live filter away from the preset.
    drift({ ...preset.filter, q: 'drifted' })
    // Assert — the drifted state reads "Custom", not the preset, so its
    // rename/delete affordances are gone (#120).
    expect(screen.queryByRole('button', { name: 'Delete this preset' })).not.toBeInTheDocument()
  })

  it('shows the applied preset NAME as the combobox value while the live filter matches (#120)', async () => {
    // Arrange — the bar's live filter equals the preset's (the applied state).
    const preset = customPreset()
    const user = userEvent.setup()
    renderPresets([preset], {}, preset.filter)
    // Act — apply the preset.
    await pickPreset(user, preset.name)
    // Assert — the combobox reads the preset's name, not the placeholder.
    expect(screen.getByRole('combobox', { name: 'Preset' })).toHaveTextContent(preset.name)
  })

  it('shows "Custom" once the live filter drifts, but never as a dropdown option (#120)', async () => {
    // Arrange — a preset is applied and matches the live filter…
    const preset = customPreset()
    const user = userEvent.setup()
    const { drift } = renderPresets([preset], {}, preset.filter)
    await pickPreset(user, preset.name)
    // Act — the live filter drifts (a facet edit).
    drift({ ...preset.filter, q: 'drifted' })
    // Assert — the collapsed combobox reads "Custom", not the preset name.
    expect(screen.getByRole('combobox', { name: 'Preset' })).toHaveTextContent('Custom')
    // …and "Custom" is NEVER a pickable row: opening the dropdown lists only real
    // presets + the create action (to persist a drifted filter you save it).
    await user.click(screen.getByRole('combobox', { name: 'Preset' }))
    expect(screen.queryByRole('option', { name: 'Custom' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Save preset' })).toBeInTheDocument()
  })

  it('shows the placeholder (no preset context) for a fresh/empty filter (#120)', () => {
    // Arrange — the default, unfiltered board with a preset available but none applied.
    const preset = customPreset()
    // Act — render with the empty filter (nothing has been applied).
    renderPresets([preset], {}, EMPTY_BOARD_FILTER)
    // Assert — the collapsed combobox shows its placeholder, not a name or Custom.
    expect(screen.getByRole('combobox', { name: 'Preset' })).toHaveTextContent('Choose a preset')
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
    // Act — open the save dialog via the dropdown's "Save preset" entry.
    await openCreatePreset(user)
    await user.type(screen.getByRole('textbox', { name: 'Preset name' }), 'Boiler P1')
    await user.click(screen.getByRole('button', { name: 'Save preset' }))
    // Assert — the POST body carries the name + the current filter (private by
    // default: shared:false), and a toast fires.
    expect(await screen.findByText('Preset saved')).toBeInTheDocument()
    expect(fake.lastBody('POST', '/api/v1/filter-presets')).toEqual({
      name: 'Boiler P1',
      filter,
      shared: false,
    })
  })

  it('saves a SHARED preset when the share toggle is enabled (POST shared:true)', async () => {
    // Arrange
    const user = userEvent.setup()
    const filter: BoardFilter = { ...EMPTY_BOARD_FILTER, priorities: ['P1'] }
    const created = customPreset({ id: uid(602), name: 'Team P1', filter, shared: true })
    const { fake } = renderPresets(
      [],
      { 'POST /api/v1/filter-presets': jsonResponse(created, 201) },
      filter,
    )
    // Act — open the save dialog, name it, flip "Share with the team", save.
    await openCreatePreset(user)
    await user.type(screen.getByRole('textbox', { name: 'Preset name' }), 'Team P1')
    await user.click(screen.getByRole('switch', { name: /Share with the team/ }))
    await user.click(screen.getByRole('button', { name: 'Save preset' }))
    // Assert — the POST body shares the preset with the team.
    expect(await screen.findByText('Preset saved')).toBeInTheDocument()
    expect(fake.lastBody('POST', '/api/v1/filter-presets')).toEqual({
      name: 'Team P1',
      filter,
      shared: true,
    })
  })

  it('disables Save until a name is entered', async () => {
    // Arrange
    const user = userEvent.setup()
    renderPresets([])
    // Act — open the save dialog via the dropdown's "Save preset" entry.
    await openCreatePreset(user)
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
    expect(await screen.findByText('Preset updated')).toBeInTheDocument()
    expect(fake.lastBody('PATCH', `/api/v1/filter-presets/${preset.id}`)).toEqual({
      name: 'Renamed',
    })
  })

  it('shares the selected owned preset from the share affordance (PATCH shared:true)', async () => {
    // Arrange — an applied, owned, currently-private preset (affordances show).
    const preset = customPreset({ shared: false })
    const user = userEvent.setup()
    const { fake } = renderPresets(
      [preset],
      { [`PATCH /api/v1/filter-presets/${preset.id}`]: jsonResponse({ ...preset, shared: true }) },
      preset.filter,
    )
    await pickPreset(user, preset.name)
    // Act — click the share affordance (a private preset offers "Share this preset").
    await user.click(screen.getByRole('button', { name: 'Share this preset' }))
    // Assert — the PATCH flips shared:true and a toast confirms.
    expect(await screen.findByText('Preset updated')).toBeInTheDocument()
    expect(fake.lastBody('PATCH', `/api/v1/filter-presets/${preset.id}`)).toEqual({ shared: true })
  })

  it("applies a teammate's shared preset but shows no owner affordances", async () => {
    // Arrange — a shared preset owned by SOMEONE ELSE (listed under "Shared with you").
    const theirs = customPreset({
      id: uid(603),
      ownerId: uid(999),
      name: 'Ops daily',
      shared: true,
    })
    const user = userEvent.setup()
    const { onApply } = renderPresets([theirs], {}, theirs.filter)
    // Act — apply it from the dropdown.
    await pickPreset(user, theirs.name)
    // Assert — its complete filter applies, but a teammate's shared preset is
    // apply-only: no rename / share / delete (those are owner-only, else 404).
    expect(onApply).toHaveBeenCalledWith(theirs.filter)
    expect(screen.queryByRole('button', { name: 'Delete this preset' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Share this preset' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Stop sharing this preset' }),
    ).not.toBeInTheDocument()
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
