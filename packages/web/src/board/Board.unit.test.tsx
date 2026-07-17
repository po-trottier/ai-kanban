import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  fixturePickerUsers,
  fixtureTech,
  makeBoard,
  makeCard,
  permissivePolicy,
} from '../test/fixtures.ts'
import { renderWithProviders } from '../test/render.tsx'
import { Board } from './Board.tsx'

const noop = () => undefined

describe('Board', () => {
  it('renders all seven lanes with their cards in position order', () => {
    // Arrange
    const first = makeCard('ready', { title: 'Fix pump' })
    const second = makeCard('ready', { title: 'Change filter' })
    const board = makeBoard({ ready: [first, second] })
    // Act
    renderWithProviders(
      <Board
        board={board}
        policy={permissivePolicy}
        role="technician"
        users={fixturePickerUsers}
        today="2026-07-16"
        onOpenCard={noop}
        onMenuAction={noop}
      />,
    )
    // Assert
    const boardRegion = screen.getByRole('region', { name: 'Kanban board' })
    const lanes = within(boardRegion).getAllByRole('region')
    expect(lanes).toHaveLength(7)
    const readyList = screen.getByRole('list', { name: 'Cards in Ready' })
    const titles = within(readyList)
      .getAllByRole('listitem')
      .map((item) => item.textContent)
    expect(titles[0]).toContain('Fix pump')
    expect(titles[1]).toContain('Change filter')
  })

  it('highlights a lane header when its WIP limit is exceeded', () => {
    // Arrange — fixture in_progress WIP limit is 3
    const cards = [
      makeCard('in_progress'),
      makeCard('in_progress'),
      makeCard('in_progress'),
      makeCard('in_progress'),
    ]
    const board = makeBoard({ in_progress: cards })
    // Act
    renderWithProviders(
      <Board
        board={board}
        policy={permissivePolicy}
        role="technician"
        users={fixturePickerUsers}
        today="2026-07-16"
        onOpenCard={noop}
        onMenuAction={noop}
      />,
    )
    // Assert
    expect(screen.getByLabelText('4/3 — WIP limit exceeded')).toBeInTheDocument()
  })

  it('shows the empty-lane hint and a plain count for unlimited lanes', () => {
    // Arrange
    const board = makeBoard({})
    // Act
    renderWithProviders(
      <Board
        board={board}
        policy={permissivePolicy}
        role="technician"
        users={fixturePickerUsers}
        today="2026-07-16"
        onOpenCard={noop}
        onMenuAction={noop}
      />,
    )
    // Assert
    expect(screen.getAllByText('No cards')).toHaveLength(7)
    const intake = screen.getByRole('region', { name: 'Intake' })
    expect(within(intake).getByLabelText('0')).toBeInTheDocument()
  })

  it('shows the assignee avatar with initials', () => {
    // Arrange
    const card = makeCard('ready', { assigneeId: fixtureTech.id })
    const board = makeBoard({ ready: [card] })
    // Act
    renderWithProviders(
      <Board
        board={board}
        policy={permissivePolicy}
        role="technician"
        users={fixturePickerUsers}
        today="2026-07-16"
        onOpenCard={noop}
        onMenuAction={noop}
      />,
    )
    // Assert
    const avatar = screen.getByLabelText('Assigned to Terry Tech')
    expect(avatar).toHaveTextContent('TT')
  })

  it('renders no placeholder avatar when a card is unassigned', () => {
    // Arrange — no assignee and no estimate: the footer row disappears too
    const card = makeCard('ready', { assigneeId: null, estimateMinutes: null })
    const board = makeBoard({ ready: [card] })
    // Act
    renderWithProviders(
      <Board
        board={board}
        policy={permissivePolicy}
        role="technician"
        users={fixturePickerUsers}
        today="2026-07-16"
        onOpenCard={noop}
        onMenuAction={noop}
      />,
    )
    // Assert
    expect(screen.queryByLabelText('Unassigned')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Assigned to/)).not.toBeInTheDocument()
  })
})
