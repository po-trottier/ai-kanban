import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  fixturePickerUsers,
  fixtureTech,
  makeBoard,
  makeCard,
  permissivePolicy,
  withCardExtras,
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
        role="user"
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

  it('marks the board busy while a filtered fetch is in flight (loading)', () => {
    // Arrange — a filter round-trip is in flight over the retained board, so the
    // board dims and reports aria-busy (skeleton/loading cue during the fetch).
    const board = makeBoard({ ready: [makeCard('ready', { title: 'Fix pump' })] })
    // Act
    renderWithProviders(
      <Board
        board={board}
        loading
        policy={permissivePolicy}
        role="user"
        users={fixturePickerUsers}
        today="2026-07-16"
        onOpenCard={noop}
        onMenuAction={noop}
      />,
    )
    // Assert
    expect(screen.getByRole('region', { name: 'Kanban board' })).toHaveAttribute(
      'aria-busy',
      'true',
    )
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
        role="user"
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
    // Arrange — one card keeps the board from collapsing to its empty state,
    // so the six other lanes still render their per-lane "No cards" hint.
    const board = makeBoard({ ready: [makeCard('ready')] })
    // Act
    renderWithProviders(
      <Board
        board={board}
        policy={permissivePolicy}
        role="user"
        users={fixturePickerUsers}
        today="2026-07-16"
        onOpenCard={noop}
        onMenuAction={noop}
      />,
    )
    // Assert
    expect(screen.getAllByText('No cards')).toHaveLength(6)
    const intake = screen.getByRole('region', { name: 'Intake' })
    expect(within(intake).getByLabelText('0')).toBeInTheDocument()
  })

  it('shows a first-run call to action when the whole board is empty', () => {
    // Arrange
    const board = makeBoard({})
    // Act
    renderWithProviders(
      <Board
        board={board}
        policy={permissivePolicy}
        role="user"
        users={fixturePickerUsers}
        today="2026-07-16"
        onOpenCard={noop}
        onMenuAction={noop}
      />,
    )
    // Assert
    expect(screen.getByText('No work orders yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New card' })).toBeInTheDocument()
  })

  it('shows a no-matches message (not the first-run CTA) when the filter matches nothing', () => {
    // Arrange — filtering is active but no lane has a match: the board shows a
    // single no-matches message hinting to widen the filter (the filter bar is
    // now the ONE search surface — scope All reaches archived/closed cards).
    const board = makeBoard({})
    // Act
    renderWithProviders(
      <Board
        board={board}
        filtering
        policy={permissivePolicy}
        role="user"
        users={fixturePickerUsers}
        today="2026-07-16"
        onOpenCard={noop}
        onMenuAction={noop}
      />,
    )
    // Assert — the no-matches message shows; the first-run "New card" CTA (wrong
    // here) does not, and there is no legacy advanced-search link.
    expect(screen.getByText('No cards match your filters')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New card' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Search all cards/ })).not.toBeInTheDocument()
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
        role="user"
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

  it('always renders estimate, assignee, and location placeholders when unset', () => {
    // Arrange — a bare card: no assignee, estimate, or location. Every card
    // must read the same, so the placeholders always appear (consistency).
    const card = makeCard('ready', { assigneeId: null, estimateMinutes: null, locationId: null })
    const board = makeBoard({ ready: [card] })
    // Act
    renderWithProviders(
      <Board
        board={board}
        policy={permissivePolicy}
        role="user"
        users={fixturePickerUsers}
        today="2026-07-16"
        onOpenCard={noop}
        onMenuAction={noop}
      />,
    )
    // Assert
    expect(screen.getByText('Unassigned')).toBeInTheDocument()
    expect(screen.getByText('No estimate')).toBeInTheDocument()
    expect(screen.getByText('No location')).toBeInTheDocument()
    // The attachment indicator always renders too — a zero reads as "no files",
    // not a missing feature (every card reads the same).
    expect(screen.getByLabelText('0 attachments')).toBeInTheDocument()
    // The real avatar is only rendered for an actual assignee.
    expect(screen.queryByLabelText(/Assigned to/)).not.toBeInTheDocument()
  })

  it('renders tags, a location, and an attachment indicator from the board summary', () => {
    // Arrange — the board payload carries the join-sourced extras the card shows.
    const card = withCardExtras(makeCard('ready', { estimateMinutes: 480 }), {
      tags: ['HVAC', 'urgent'],
      attachmentCount: 2,
      locationLabel: 'Room 101',
    })
    const board = makeBoard({ ready: [card] })
    // Act
    renderWithProviders(
      <Board
        board={board}
        policy={permissivePolicy}
        role="user"
        users={fixturePickerUsers}
        today="2026-07-16"
        onOpenCard={noop}
        onMenuAction={noop}
      />,
    )
    // Assert
    expect(screen.getByText('HVAC')).toBeInTheDocument()
    expect(screen.getByText('urgent')).toBeInTheDocument()
    expect(screen.getByText('Room 101')).toBeInTheDocument()
    expect(screen.getByText('1d')).toBeInTheDocument()
    expect(screen.getByLabelText('2 attachments')).toBeInTheDocument()
  })

  it('renders each tag pill at natural width and clips overflow at the row, not the pill', () => {
    // Arrange — more tags than fit on one line so the ROW must clip. Each pill
    // must still be individually readable (no per-tag ellipsis).
    const tags = [
      'heating-ventilation-air-conditioning',
      'safety-critical',
      'roof-access',
      'vendor',
    ]
    const card = withCardExtras(makeCard('ready'), { tags })
    const board = makeBoard({ ready: [card] })
    // Act
    renderWithProviders(
      <Board
        board={board}
        policy={permissivePolicy}
        role="user"
        users={fixturePickerUsers}
        today="2026-07-16"
        onOpenCard={noop}
        onMenuAction={noop}
      />,
    )
    // Assert — every pill carries its FULL text (natural width, not truncated).
    for (const tag of tags) expect(screen.getByText(tag)).toBeInTheDocument()
    // The overflow is truncated at the ROW: pills live in the single clipping
    // container, and the complete set (including any pill clipped off-screen) is
    // reachable via its aria-label so nothing is lost.
    const row = screen.getByLabelText(`Tags: ${tags.join(', ')}`)
    for (const tag of tags) expect(within(row).getByText(tag)).toBeInTheDocument()
  })
})
