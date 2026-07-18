import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import {
  enforcedPolicy,
  makeBoard,
  makeCard,
  permissivePolicy,
  policyDenyingUser,
} from '../test/fixtures.ts'
import { renderWithProviders } from '../test/render.tsx'
import { MoveCardModal, type MoveSelection } from './MoveCardModal.tsx'

describe('MoveCardModal', () => {
  it('emits the neighbor-id move command for the chosen lane and position', async () => {
    // Arrange
    const user = userEvent.setup()
    const a = makeCard('ready', { title: 'Fix pump' })
    const b = makeCard('ready', { title: 'Change filter' })
    const moving = makeCard('intake', { title: 'New leak' })
    const board = makeBoard({ intake: [moving], ready: [a, b] })
    const selections: MoveSelection[] = []
    renderWithProviders(
      <MoveCardModal
        card={moving}
        currentLane="intake"
        board={board}
        policy={permissivePolicy}
        role="user"
        onSubmit={(selection) => selections.push(selection)}
        onClose={() => undefined}
      />,
    )
    // Act
    await user.click(screen.getByRole('combobox', { name: 'Column' }))
    await user.click(screen.getByRole('option', { name: 'Ready' }))
    await user.click(screen.getByRole('combobox', { name: 'Position' }))
    await user.click(screen.getByRole('option', { name: 'After "Fix pump"' }))
    await user.click(screen.getByRole('button', { name: 'Move' }))
    // Assert
    expect(selections).toEqual([
      {
        intent: { toLane: 'ready', prevCardId: a.id, nextCardId: b.id },
        laneLabel: 'Ready',
        position: 2,
      },
    ])
  })

  it('offers explicit First and Last (not "After <last card>") for the bottom (ITEM 2)', async () => {
    // Arrange — a two-card target lane, so First / After / Last all appear.
    const user = userEvent.setup()
    const a = makeCard('ready', { title: 'Fix pump' })
    const b = makeCard('ready', { title: 'Change filter' })
    const moving = makeCard('intake', { title: 'New leak' })
    const board = makeBoard({ intake: [moving], ready: [a, b] })
    const selections: MoveSelection[] = []
    renderWithProviders(
      <MoveCardModal
        card={moving}
        currentLane="intake"
        board={board}
        policy={permissivePolicy}
        role="user"
        onSubmit={(selection) => selections.push(selection)}
        onClose={() => undefined}
      />,
    )
    // Act
    await user.click(screen.getByRole('combobox', { name: 'Column' }))
    await user.click(screen.getByRole('option', { name: 'Ready' }))
    await user.click(screen.getByRole('combobox', { name: 'Position' }))
    // Assert — the bottom is a clear "Last (bottom)", not "After \"Change filter\"".
    expect(screen.getByRole('option', { name: 'First (top)' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Last (bottom)' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'After "Change filter"' })).not.toBeInTheDocument()
    // Act — pick Last and confirm it emits the bottom neighbor ids.
    await user.click(screen.getByRole('option', { name: 'Last (bottom)' }))
    await user.click(screen.getByRole('button', { name: 'Move' }))
    // Assert
    expect(selections).toEqual([
      {
        intent: { toLane: 'ready', prevCardId: b.id, nextCardId: null },
        laneLabel: 'Ready',
        position: 3,
      },
    ])
  })

  it('always offers First and Last when moving into an empty column (ITEM 2)', async () => {
    // Arrange — Ready is empty in this board.
    const user = userEvent.setup()
    const moving = makeCard('intake', { title: 'Fresh work order' })
    const board = makeBoard({ intake: [moving] })
    renderWithProviders(
      <MoveCardModal
        card={moving}
        currentLane="intake"
        board={board}
        policy={permissivePolicy}
        role="user"
        onSubmit={() => undefined}
        onClose={() => undefined}
      />,
    )
    // Act
    await user.click(screen.getByRole('combobox', { name: 'Column' }))
    await user.click(screen.getByRole('option', { name: 'Ready' }))
    await user.click(screen.getByRole('combobox', { name: 'Position' }))
    // Assert — both Top and Bottom show (consistent shape), even when empty.
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(2)
    expect(options[0]).toHaveTextContent('First (top)')
    expect(options[1]).toHaveTextContent('Last (bottom)')
  })

  it('disables illegal target lanes when enforcement is on (policy affordances)', async () => {
    // Arrange
    const user = userEvent.setup()
    const moving = makeCard('intake')
    const board = makeBoard({ intake: [moving] })
    renderWithProviders(
      <MoveCardModal
        card={moving}
        currentLane="intake"
        board={board}
        policy={enforcedPolicy}
        role="user"
        onSubmit={() => undefined}
        onClose={() => undefined}
      />,
    )
    // Act
    await user.click(screen.getByRole('combobox', { name: 'Column' }))
    // Assert — from intake only waiting_approval is a seeded edge
    expect(screen.getByRole('option', { name: 'Waiting for Approval' })).not.toHaveAttribute(
      'data-combobox-disabled',
    )
    expect(screen.getByRole('option', { name: 'Ready' })).toHaveAttribute('data-combobox-disabled')
    expect(screen.getByRole('option', { name: 'Done' })).toHaveAttribute('data-combobox-disabled')
  })

  it('disables Move (with the reason) when the preselected lane is itself gated', () => {
    // Arrange — reorderReady above the user role gates the current Ready lane
    const moving = makeCard('ready')
    const board = makeBoard({ ready: [moving] })
    const gated = policyDenyingUser('card.move')
    // Act
    renderWithProviders(
      <MoveCardModal
        card={moving}
        currentLane="ready"
        board={board}
        policy={gated}
        role="user"
        onSubmit={() => undefined}
        onClose={() => undefined}
      />,
    )
    // Assert
    expect(screen.getByRole('button', { name: 'Move' })).toBeDisabled()
    expect(screen.getByText('Not allowed from the current column')).toBeInTheDocument()
  })

  it('closes without submitting when nothing was changed (no spurious reorder)', async () => {
    // Arrange — the default selection is the card's current position
    const user = userEvent.setup()
    const moving = makeCard('ready')
    const other = makeCard('ready')
    const board = makeBoard({ ready: [moving, other] })
    const selections: MoveSelection[] = []
    let closed = 0
    renderWithProviders(
      <MoveCardModal
        card={moving}
        currentLane="ready"
        board={board}
        policy={permissivePolicy}
        role="user"
        onSubmit={(selection) => selections.push(selection)}
        onClose={() => {
          closed += 1
        }}
      />,
    )
    // Act
    await user.click(screen.getByRole('button', { name: 'Move' }))
    // Assert
    expect(selections).toEqual([])
    expect(closed).toBe(1)
  })

  it('marks the waiting reason and resume date as required when entering Waiting', async () => {
    // Arrange
    const user = userEvent.setup()
    const moving = makeCard('in_progress', { title: 'Swap motor' })
    const board = makeBoard({ in_progress: [moving] })
    renderWithProviders(
      <MoveCardModal
        card={moving}
        currentLane="in_progress"
        board={board}
        policy={permissivePolicy}
        role="user"
        onSubmit={() => undefined}
        onClose={() => undefined}
      />,
    )
    // Act — choose the Waiting lane so the inline fields appear.
    await user.click(screen.getByRole('combobox', { name: 'Column' }))
    await user.click(screen.getByRole('option', { name: 'Waiting on Parts / Vendor' }))
    // Assert — Move is off until both required fields are filled.
    expect(screen.getByRole('button', { name: 'Move' })).toBeDisabled()
    // Act — pick a reason but leave the date empty; the date error surfaces.
    await user.click(screen.getByRole('combobox', { name: /Waiting reason/ }))
    await user.click(screen.getByRole('option', { name: 'Parts' }))
    // Assert — the empty resume date now shows its required message at the
    // field (not just the greyed-out Move button).
    expect(screen.getByText('Pick the expected resume date')).toBeInTheDocument()
  })

  it('offers every lane in the permissive default', async () => {
    // Arrange
    const user = userEvent.setup()
    const moving = makeCard('done', { resolution: 'completed' })
    const board = makeBoard({ done: [moving] })
    renderWithProviders(
      <MoveCardModal
        card={moving}
        currentLane="done"
        board={board}
        policy={permissivePolicy}
        role="user"
        onSubmit={() => undefined}
        onClose={() => undefined}
      />,
    )
    // Act
    await user.click(screen.getByRole('combobox', { name: 'Column' }))
    // Assert
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(7)
    expect(options.filter((option) => option.hasAttribute('data-combobox-disabled'))).toHaveLength(
      0,
    )
  })
})
