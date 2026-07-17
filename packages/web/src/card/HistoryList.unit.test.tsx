import { type CardEvent } from '@rivian-kanban/core'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { type HistoryContext } from '../lib/history.ts'
import { fixtureAdmin, makeCard, makeStatusChangedEvent, uid } from '../test/fixtures.ts'
import { renderWithProviders } from '../test/render.tsx'
import { HistoryList } from './HistoryList.tsx'

const card = makeCard('review')
const context: HistoryContext = {
  userNames: new Map([[fixtureAdmin.id, fixtureAdmin.displayName]]),
  laneLabels: { review: 'Review', done: 'Done' },
}
const noop = () => undefined

describe('HistoryList', () => {
  it('renders audit events oldest-first as human-readable lines', () => {
    // Arrange
    const events: CardEvent[] = [
      {
        id: uid(95),
        cardId: card.id,
        actorId: fixtureAdmin.id,
        actorKind: 'user',
        createdAt: '2026-07-01T10:00:00.000Z',
        eventType: 'card.blocked',
        payload: { reason: 'parts missing' },
      },
      makeStatusChangedEvent(card, 6, 'review', 'done'),
    ]
    // Act
    renderWithProviders(
      <HistoryList
        events={events}
        context={context}
        hasMore={false}
        loadingMore={false}
        onLoadMore={noop}
      />,
    )
    // Assert — an unnumbered timeline: a plain list, not an ordered one
    expect(screen.getByRole('list', { name: 'History' }).tagName).toBe('UL')
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Ada Admin blocked the card: parts missing')
    expect(items[1]).toHaveTextContent('Ada Admin moved the card from Review to Done')
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  })

  it('shows an empty state when there is no history yet', () => {
    // Arrange
    const events: CardEvent[] = []
    // Act
    renderWithProviders(
      <HistoryList
        events={events}
        context={context}
        hasMore={false}
        loadingMore={false}
        onLoadMore={noop}
      />,
    )
    // Assert
    expect(screen.getByText('No history yet')).toBeInTheDocument()
  })

  it('offers cursor-driven Load more while more pages exist', async () => {
    // Arrange
    const user = userEvent.setup()
    const loads: number[] = []
    // Act
    renderWithProviders(
      <HistoryList
        events={[makeStatusChangedEvent(card, 7, 'ready', 'in_progress')]}
        context={context}
        hasMore
        loadingMore={false}
        onLoadMore={() => loads.push(1)}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Load more' }))
    // Assert
    expect(loads).toHaveLength(1)
  })
})
