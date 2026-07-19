import { describe, expect, it } from 'vitest'
import { makeCard } from '../test/fixtures.ts'
import { BLOCKED_COLOR, CANCELLED_COLOR, OVERDUE_COLOR, WAITING_COLOR } from '../theme.ts'
import { cardStatusColor } from './card-status.ts'

const TODAY = '2026-07-19'

describe('cardStatusColor', () => {
  it('returns undefined for a plain on-track card (no status accent)', () => {
    // Arrange
    const card = makeCard('ready')
    // Act
    const color = cardStatusColor(card, TODAY)
    // Assert
    expect(color).toBeUndefined()
  })

  it('uses the board card badge hues per status, blocked winning first', () => {
    // Arrange — the same theme colors CardBadges paints on the board card.
    const blocked = makeCard('in_progress', { blocked: true })
    const waiting = makeCard('waiting_parts_vendor', {
      waitingReason: 'parts',
      expectedResumeAt: '2026-08-01',
    })
    const cancelled = makeCard('done', { resolution: 'cancelled' })
    // Act
    const blockedColor = cardStatusColor(blocked, TODAY)
    const waitingColor = cardStatusColor(waiting, TODAY)
    const cancelledColor = cardStatusColor(cancelled, TODAY)
    // Assert
    expect(blockedColor).toBe(BLOCKED_COLOR)
    expect(waitingColor).toBe(WAITING_COLOR)
    expect(cancelledColor).toBe(CANCELLED_COLOR)
  })

  it('flips a waiting card to the overdue hue once its resume date has passed', () => {
    // Arrange — resume date sits before today, so the card is overdue.
    const overdue = makeCard('waiting_parts_vendor', {
      waitingReason: 'vendor',
      expectedResumeAt: '2026-07-01',
    })
    // Act
    const color = cardStatusColor(overdue, TODAY)
    // Assert
    expect(color).toBe(OVERDUE_COLOR)
  })
})
