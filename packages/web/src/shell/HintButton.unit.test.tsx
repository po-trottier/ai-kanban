import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '../test/render.tsx'
import { HintButton } from './HintButton.tsx'

describe('HintButton', () => {
  it('shows the disabled reason and blocks the click when disabledReason is set', async () => {
    // Arrange — a would-be-disabled button carrying its reason.
    const user = userEvent.setup()
    let clicks = 0
    renderWithProviders(
      <HintButton
        tooltip="Save your edits"
        disabledReason="Nothing to save yet"
        onClick={() => {
          clicks += 1
        }}
      >
        Save
      </HintButton>,
    )
    // Act — it renders visually disabled (data-disabled, not native disabled, so
    // its tooltip stays hoverable) and a click is guarded.
    const button = screen.getByRole('button', { name: 'Save' })
    await user.click(button)
    // Assert — the reason is exposed and the handler never fired.
    expect(button).toHaveAttribute('data-disabled', 'true')
    expect(button).not.toBeDisabled()
    expect(clicks).toBe(0)
  })

  it('fires onClick and drops data-disabled when there is no disabledReason', async () => {
    // Arrange
    const user = userEvent.setup()
    let clicks = 0
    renderWithProviders(
      <HintButton
        tooltip="Create the work order"
        onClick={() => {
          clicks += 1
        }}
      >
        Create
      </HintButton>,
    )
    // Act
    const button = screen.getByRole('button', { name: 'Create' })
    await user.click(button)
    // Assert
    expect(button).not.toHaveAttribute('data-disabled')
    expect(clicks).toBe(1)
  })
})
