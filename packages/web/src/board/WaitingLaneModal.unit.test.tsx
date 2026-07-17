import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { nth } from '../test/fixtures.ts'
import { renderWithProviders } from '../test/render.tsx'
import { WaitingLaneModal } from './WaitingLaneModal.tsx'

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

  it('emits the reason and ISO date once both are provided', async () => {
    // Arrange
    const user = userEvent.setup()
    const submissions: { waitingReason: string; expectedResumeAt: string }[] = []
    renderWithProviders(
      <WaitingLaneModal
        onSubmit={(values) => submissions.push(values)}
        onClose={() => undefined}
      />,
    )
    // Act
    await user.click(screen.getByRole('combobox', { name: 'Waiting reason' }))
    await user.click(screen.getByRole('option', { name: 'Parts' }))
    await user.click(screen.getByRole('button', { name: 'Expected resume date' }))
    await user.click(nth(screen.getAllByRole('button', { name: /15 July 2026/ }), 0))
    await user.click(screen.getByRole('button', { name: 'Move card' }))
    // Assert
    expect(submissions).toHaveLength(1)
    expect(submissions[0]?.waitingReason).toBe('parts')
    expect(submissions[0]?.expectedResumeAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
