import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '../test/render.tsx'
import { strings } from '../strings.ts'
import { BoardLegend } from './BoardLegend.tsx'

/** Each legend meaning bolds the term before the "—", so a row's copy spans a
 * <span> (the term) plus a text node (the detail). Match the wrapping <p> by
 * its full cross-node text so the assertion sees the reconstructed sentence. */
function wholeText(full: string) {
  return (_content: string, element: Element | null): boolean =>
    element?.tagName.toLowerCase() === 'p' && element.textContent === full
}

/** The legend teaches non-technical users the board's colored badges, so every
 * board state must appear with a badge matching what the board renders. Its
 * trigger is a compact help icon; the guide itself is a centered dialog so its
 * rows never clip at the viewport edge. */
describe('BoardLegend', () => {
  it('opens from a labelled help icon and lands in a dialog', async () => {
    // Arrange
    const user = userEvent.setup()
    renderWithProviders(<BoardLegend />)
    // Closed: the guide is not shown as a dialog yet (a closed Mantine Modal
    // keeps only its inert root wrapper — no dialog role).
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // Act — the trigger is an icon button with an accessible name, not a text
    // button; opening it surfaces the guide as a dialog (Modal), not a popover.
    await user.click(screen.getByRole('button', { name: strings.board.legendButton }))
    // Assert
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(strings.board.legendTitle)).toBeInTheDocument()
  })

  it('explains every board state, including Overdue', async () => {
    // Arrange
    const user = userEvent.setup()
    renderWithProviders(<BoardLegend />)
    // Act
    await user.click(screen.getByRole('button', { name: strings.board.legendButton }))
    await screen.findByText(strings.board.legendStates)
    // Assert — each state row is present, including the Overdue row (previously
    // missing, its copy dead) now alongside the others.
    expect(screen.getByText(wholeText(strings.board.legendBlocked))).toBeInTheDocument()
    expect(screen.getByText(wholeText(strings.board.legendWaiting))).toBeInTheDocument()
    expect(screen.getByText(wholeText(strings.board.legendOverdue))).toBeInTheDocument()
    expect(screen.getByText(wholeText(strings.board.legendCancelled))).toBeInTheDocument()
    expect(screen.getByText(wholeText(strings.board.legendArchived))).toBeInTheDocument()
  })

  it('shows a Cancelled badge and a separate Overdue badge (matching the board)', async () => {
    // Arrange
    const user = userEvent.setup()
    renderWithProviders(<BoardLegend />)
    // Act
    await user.click(screen.getByRole('button', { name: strings.board.legendButton }))
    await screen.findByText(strings.board.legendStates)
    // Assert — the Cancelled badge word matches the board's gray cancelled
    // badge, and a distinct Overdue badge covers the red overdue state (the
    // Cancelled row is no longer mislabeled red / the Overdue row no longer
    // absent). "Overdue" also appears as the bolded term of its meaning row, so
    // target the badge specifically (its label class) to stay unambiguous.
    expect(screen.getByText(strings.resolutions.cancelled)).toBeInTheDocument()
    const overdueBadge = screen
      .getAllByText(strings.board.legendOverdueBadge)
      .find((element) => element.className.includes('Badge-label'))
    expect(overdueBadge).toBeDefined()
  })
})
