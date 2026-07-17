import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { enforcedPolicy, makeBoard, makeCard, permissivePolicy } from '../test/fixtures.ts'
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
        role="technician"
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
        role="technician"
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
    const gated = { ...permissivePolicy, actionGates: { reorderReady: 'supervisor' as const } }
    // Act
    renderWithProviders(
      <MoveCardModal
        card={moving}
        currentLane="ready"
        board={board}
        policy={gated}
        role="technician"
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
        role="technician"
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
        role="requester"
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
