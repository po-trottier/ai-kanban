import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
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
})
