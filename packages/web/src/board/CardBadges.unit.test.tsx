import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { makeCard } from '../test/fixtures.ts'
import { renderWithProviders } from '../test/render.tsx'
import { CardBadges } from './CardBadges.tsx'

describe('CardBadges', () => {
  it('always shows the priority badge', () => {
    // Arrange
    const card = makeCard('ready', { priority: 'P0' })
    // Act
    renderWithProviders(<CardBadges card={card} today="2026-07-16" />)
    // Assert
    expect(screen.getByText('P0')).toBeInTheDocument()
  })

  it('shows the blocked badge when the card carries the blocked flag', () => {
    // Arrange
    const card = makeCard('in_progress', {
      blocked: true,
      blockedReason: 'vendor no-show',
      blockedAt: '2026-07-10T08:00:00.000Z',
    })
    // Act
    renderWithProviders(<CardBadges card={card} today="2026-07-16" />)
    // Assert
    expect(screen.getByText('Blocked')).toBeInTheDocument()
  })

  it('shows a waiting badge with the reason while resume is in the future', () => {
    // Arrange
    const card = makeCard('waiting_parts_vendor', {
      waitingReason: 'parts',
      expectedResumeAt: '2026-07-20',
    })
    // Act
    renderWithProviders(<CardBadges card={card} today="2026-07-16" />)
    // Assert
    expect(screen.getByText('Waiting: Parts')).toBeInTheDocument()
    expect(screen.queryByText(/Overdue/)).not.toBeInTheDocument()
  })

  it('switches to overdue styling the day after the expected resume date', () => {
    // Arrange
    const card = makeCard('waiting_parts_vendor', {
      waitingReason: 'vendor',
      expectedResumeAt: '2026-07-15',
    })
    // Act
    renderWithProviders(<CardBadges card={card} today="2026-07-16" />)
    // Assert
    expect(screen.getByText('Overdue: Vendor')).toBeInTheDocument()
  })

  it('badges cancelled cards with their resolution', () => {
    // Arrange
    const card = makeCard('done', { resolution: 'duplicate' })
    // Act
    renderWithProviders(<CardBadges card={card} today="2026-07-16" />)
    // Assert
    expect(screen.getByText('Duplicate')).toBeInTheDocument()
  })

  it('explains the color-only waiting badge on hover (a plain-language tooltip)', async () => {
    // Arrange — a color-only chip must not rely on color alone to convey state.
    const user = userEvent.setup()
    const card = makeCard('waiting_parts_vendor', {
      waitingReason: 'parts',
      expectedResumeAt: '2026-07-20',
    })
    renderWithProviders(<CardBadges card={card} today="2026-07-16" />)
    // Act
    await user.hover(screen.getByText('Waiting: Parts'))
    // Assert — the tooltip reads "expected to resume" (NOT "paused": the
    // business-hours timer keeps counting while waiting — ADR-019/#102).
    expect(await screen.findByText(/expected to resume by/i)).toBeInTheDocument()
    expect(screen.queryByText(/paused/i)).not.toBeInTheDocument()
  })

  it('explains the priority badge on hover with its plain-language meaning', async () => {
    // Arrange — the color-only priority chip spells out its meaning on hover.
    const user = userEvent.setup()
    const card = makeCard('ready', { priority: 'P0' })
    renderWithProviders(<CardBadges card={card} today="2026-07-16" />)
    // Act
    await user.hover(screen.getByText('P0'))
    // Assert — reuses the same copy the picker shows (Critical — Drop everything).
    expect(await screen.findByText('Critical — Drop everything')).toBeInTheDocument()
  })

  it('explains the cancelled badge on hover', async () => {
    // Arrange
    const user = userEvent.setup()
    const card = makeCard('done', { resolution: 'duplicate' })
    renderWithProviders(<CardBadges card={card} today="2026-07-16" />)
    // Act
    await user.hover(screen.getByText('Duplicate'))
    // Assert
    expect(await screen.findByText(/filter the board to All/i)).toBeInTheDocument()
  })
})
