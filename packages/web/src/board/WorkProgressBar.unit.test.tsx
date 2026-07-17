import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '../test/render.tsx'
import { WorkProgressBar } from './WorkProgressBar.tsx'

const DAY_MS = 24 * 60 * 60 * 1000

describe('WorkProgressBar', () => {
  it('shows an empty bar for a card whose work just started', () => {
    // Arrange — started "now" so no business time has elapsed yet (0%).
    const startedAt = new Date().toISOString()
    // Act
    renderWithProviders(<WorkProgressBar workStartedAt={startedAt} estimateMinutes={120} />)
    // Assert
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '0')
    expect(bar).toHaveAccessibleName('Work progress: 0% of the estimate')
  })

  it('fills to 100% and marks overdue once well past the estimate', () => {
    // Arrange — started 30 days ago: far beyond any small estimate, in any timezone.
    const startedAt = new Date(Date.now() - 30 * DAY_MS).toISOString()
    // Act
    renderWithProviders(<WorkProgressBar workStartedAt={startedAt} estimateMinutes={120} />)
    // Assert
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '100')
    expect(bar).toHaveAccessibleName('Work progress: 100% of the estimate')
  })
})
