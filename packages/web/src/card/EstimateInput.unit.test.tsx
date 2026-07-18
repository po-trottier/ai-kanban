import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import dayjs from '../lib/dayjs.ts'
import { nth } from '../test/fixtures.ts'
import { renderWithProviders } from '../test/render.tsx'
import { EstimateInput } from './EstimateInput.tsx'

describe('EstimateInput', () => {
  it('shows a stored minutes value in its friendliest whole unit (960 → 2 Days)', () => {
    // Arrange
    const minutes = 960
    // Act
    renderWithProviders(
      <EstimateInput minutes={minutes} cleared={null} onChange={() => undefined} />,
    )
    // Assert — the number input shows 2 and the unit combobox shows Days
    expect(screen.getByRole('textbox', { name: 'Estimated time to completion' })).toHaveValue('2')
    expect(screen.getByRole('combobox', { name: 'Time unit' })).toHaveValue('Days')
  })

  it('converts a value entered in days to stored minutes (2 days → 960)', async () => {
    // Arrange
    const user = userEvent.setup()
    const emitted: (number | null | undefined)[] = []
    renderWithProviders(
      <EstimateInput minutes={null} cleared={null} onChange={(m) => emitted.push(m)} />,
    )
    // Act — pick Days, then type 2
    await user.click(screen.getByRole('combobox', { name: 'Time unit' }))
    await user.click(screen.getByRole('option', { name: 'Days' }))
    await user.type(screen.getByRole('textbox', { name: 'Estimated time to completion' }), '2')
    // Assert — the last emitted value is the minutes equivalent
    expect(emitted.at(-1)).toBe(960)
  })

  it('emits the cleared value when the number is removed', async () => {
    // Arrange
    const user = userEvent.setup()
    const emitted: (number | null | undefined)[] = []
    renderWithProviders(
      <EstimateInput minutes={120} cleared={null} onChange={(m) => emitted.push(m)} />,
    )
    // Act
    await user.clear(screen.getByRole('textbox', { name: 'Estimated time to completion' }))
    // Assert
    expect(emitted.at(-1)).toBeNull()
  })

  describe('target-date mode', () => {
    // Pin the clock to Wed 2026-07-15 09:00 in the fixture user's zone (LA) so
    // picking "today" leaves a full 8h business window (480 min) to derive from.
    const NOW = new Date('2026-07-15T16:00:00.000Z') // 09:00 America/Los_Angeles

    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      vi.setSystemTime(NOW)
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('derives the estimate minutes from a picked target date (business hours)', async () => {
      // Arrange — today is always selectable (>= minDate); its label is D MMMM YYYY.
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const todayLabel = dayjs().tz('America/Los_Angeles').format('D MMMM YYYY')
      const emitted: (number | null | undefined)[] = []
      renderWithProviders(
        <EstimateInput minutes={null} cleared={null} onChange={(m) => emitted.push(m)} />,
      )
      // Act — switch to the date mode, open the picker, pick today
      await user.click(screen.getByRole('radio', { name: 'Target date' }))
      await user.click(screen.getByRole('button', { name: 'Target completion date' }))
      await user.click(nth(screen.getAllByRole('button', { name: todayLabel }), 0))
      // Assert — 09:00 → 17:00 local = 480 business minutes
      expect(emitted.at(-1)).toBe(480)
    })
  })
})
