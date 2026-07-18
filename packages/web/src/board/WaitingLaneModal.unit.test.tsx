import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import dayjs from '../lib/dayjs.ts'
import { nth } from '../test/fixtures.ts'
import { renderWithProviders } from '../test/render.tsx'
import { WaitingLaneModal } from './WaitingLaneModal.tsx'

/** Today's day-button label — always selectable (>= the minDate). */
const todayLabel = dayjs().format('D MMMM YYYY')

describe('WaitingLaneModal', () => {
  it('requires both a reason and a resume date before submitting', async () => {
    // Arrange
    const user = userEvent.setup()
    const submissions: unknown[] = []
    renderWithProviders(
      <WaitingLaneModal
        onSubmit={(values) => submissions.push(values)}
        onClose={() => undefined}
      />,
    )
    // Act
    await user.click(screen.getByRole('button', { name: 'Move card' }))
    // Assert
    expect(submissions).toEqual([])
    expect(screen.getByText('Pick a waiting reason')).toBeInTheDocument()
    expect(screen.getByText('Pick the expected resume date')).toBeInTheDocument()
  })

  it('emits the reason, ISO date, and optional note once provided', async () => {
    // Arrange
    const user = userEvent.setup()
    const submissions: { waitingReason: string; expectedResumeAt: string; comment?: string }[] = []
    renderWithProviders(
      <WaitingLaneModal
        onSubmit={(values) => submissions.push(values)}
        onClose={() => undefined}
      />,
    )
    // Act — pick a reason, today's (selectable) resume date, and an optional note
    await user.click(screen.getByRole('combobox', { name: 'Waiting reason' }))
    await user.click(screen.getByRole('option', { name: 'Parts' }))
    await user.click(screen.getByRole('button', { name: 'Expected resume date' }))
    await user.click(nth(screen.getAllByRole('button', { name: todayLabel }), 0))
    await user.type(screen.getByRole('textbox', { name: 'Note (optional)' }), 'Waiting on PO 4412')
    await user.click(screen.getByRole('button', { name: 'Move card' }))
    // Assert
    expect(submissions).toHaveLength(1)
    expect(submissions[0]?.waitingReason).toBe('parts')
    expect(submissions[0]?.expectedResumeAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(submissions[0]?.comment).toBe('Waiting on PO 4412')
  })
})
