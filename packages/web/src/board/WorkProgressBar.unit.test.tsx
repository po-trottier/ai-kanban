import { screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../test/render.tsx'
import { WorkProgressBar } from './WorkProgressBar.tsx'

const DAY_MS = 24 * 60 * 60 * 1000

/** The fixture user's zone is America/Los_Angeles (UTC-8 in January). */
// 2026-01-01 18:00Z = 10:00 Thu in LA → business hours (timer running).
const BUSINESS_HOURS = new Date('2026-01-01T18:00:00.000Z')
// 2026-01-01 06:00Z = 22:00 Wed in LA → outside business hours (timer paused).
const OFF_HOURS = new Date('2026-01-01T06:00:00.000Z')

describe('WorkProgressBar', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows an empty bar for a card whose work just started', () => {
    // Arrange — started "now" so no business time has elapsed yet (0%).
    vi.setSystemTime(BUSINESS_HOURS)
    const startedAt = BUSINESS_HOURS.toISOString()
    // Act
    renderWithProviders(<WorkProgressBar workStartedAt={startedAt} estimateMinutes={120} />)
    // Assert
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '0')
    expect(bar).toHaveAccessibleName(/Work progress: 0% of the estimate/)
  })

  it('fills to 100% and marks overdue once well past the estimate', () => {
    // Arrange — started 30 days ago: far beyond any small estimate, in any timezone.
    vi.setSystemTime(BUSINESS_HOURS)
    const startedAt = new Date(BUSINESS_HOURS.getTime() - 30 * DAY_MS).toISOString()
    // Act
    renderWithProviders(<WorkProgressBar workStartedAt={startedAt} estimateMinutes={120} />)
    // Assert
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '100')
    expect(bar).toHaveAccessibleName(/Work progress: 100% of the estimate/)
  })

  it('shows the timer RUNNING with the working reason during business hours', () => {
    // Arrange — inside the viewer's 09:00–17:00 window, no waiting/blocked.
    vi.setSystemTime(BUSINESS_HOURS)
    // Act
    renderWithProviders(
      <WorkProgressBar workStartedAt={BUSINESS_HOURS.toISOString()} estimateMinutes={120} />,
    )
    // Assert
    expect(screen.getByText(/Running — counting work time/)).toBeInTheDocument()
  })

  it('shows the timer PAUSED (outside business hours) at night', () => {
    // Arrange — 22:00 local, outside the window, so accrual is genuinely paused.
    vi.setSystemTime(OFF_HOURS)
    // Act
    renderWithProviders(
      <WorkProgressBar workStartedAt={OFF_HOURS.toISOString()} estimateMinutes={120} />,
    )
    // Assert
    expect(screen.getByText(/Paused — outside business hours/)).toBeInTheDocument()
  })

  it('stays RUNNING but names the waiting reason during business hours', () => {
    // Arrange — waiting on parts/vendor does NOT pause accrual, only labels it.
    vi.setSystemTime(BUSINESS_HOURS)
    // Act
    renderWithProviders(
      <WorkProgressBar
        workStartedAt={BUSINESS_HOURS.toISOString()}
        estimateMinutes={120}
        waiting
      />,
    )
    // Assert
    expect(screen.getByText(/Running — waiting on parts\/vendor/)).toBeInTheDocument()
  })

  it('surfaces the blocked reason over waiting during business hours', () => {
    // Arrange — blocked outranks waiting for the label.
    vi.setSystemTime(BUSINESS_HOURS)
    // Act
    renderWithProviders(
      <WorkProgressBar
        workStartedAt={BUSINESS_HOURS.toISOString()}
        estimateMinutes={120}
        waiting
        blocked
      />,
    )
    // Assert
    expect(screen.getByText(/Running — work order is blocked/)).toBeInTheDocument()
  })
})
