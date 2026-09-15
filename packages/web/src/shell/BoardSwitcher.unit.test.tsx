import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { makeBoardEntity } from '../test/fixtures.ts'
import { renderWithProviders } from '../test/render.tsx'
import { BoardSwitcher, type BoardSwitcherProps } from './BoardSwitcher.tsx'
import { CardPanelSlotContext } from './card-panel-slot.ts'

const boardA = makeBoardEntity({ id: 'a', name: 'Facilities North', isDefault: true })
const boardB = makeBoardEntity({ id: 'b', name: 'Facilities South' })

function renderSwitcher(props: Partial<BoardSwitcherProps> = {}) {
  const setOpenCardId = vi.fn()
  const view = renderWithProviders(
    <CardPanelSlotContext.Provider value={{ openCardId: null, setOpenCardId }}>
      <BoardSwitcher
        boards={[boardA, boardB]}
        selectedId="a"
        canManage={false}
        loading={false}
        onSelect={vi.fn()}
        {...props}
      />
    </CardPanelSlotContext.Provider>,
  )
  return { ...view, setOpenCardId }
}

describe('BoardSwitcher', () => {
  it('shows the selected board name as the trigger label', () => {
    // Arrange
    // Act
    renderSwitcher()
    // Assert
    expect(screen.getByText('Facilities North')).toBeInTheDocument()
  })

  it('lists every allowed board and calls onSelect for a different one', async () => {
    // Arrange
    const user = userEvent.setup()
    const onSelect = vi.fn()
    renderSwitcher({ onSelect })
    // Act
    await user.click(screen.getByRole('button', { name: /Switch board/ }))
    await user.click(await screen.findByRole('menuitem', { name: 'Facilities South' }))
    // Assert
    expect(onSelect).toHaveBeenCalledWith('b')
  })

  it('shows a "Manage boards" entry only when canManage is true', async () => {
    // Arrange
    const user = userEvent.setup()
    renderSwitcher({ canManage: true })
    // Act
    await user.click(screen.getByRole('button', { name: /Switch board/ }))
    // Assert
    expect(await screen.findByRole('menuitem', { name: 'Manage boards' })).toBeInTheDocument()
  })

  it('omits "Manage boards" for a non-admin', async () => {
    // Arrange
    const user = userEvent.setup()
    renderSwitcher({ canManage: false })
    // Act
    await user.click(screen.getByRole('button', { name: /Switch board/ }))
    // Assert
    expect(screen.queryByRole('menuitem', { name: 'Manage boards' })).not.toBeInTheDocument()
  })

  it('shows a meaningful empty message when no boards are allowed', () => {
    // Arrange
    // Act
    renderSwitcher({ boards: [], selectedId: null })
    // Assert
    expect(screen.getByText('No boards available')).toBeInTheDocument()
  })
})
