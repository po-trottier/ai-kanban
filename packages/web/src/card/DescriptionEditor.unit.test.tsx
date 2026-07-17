import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '../test/render.tsx'
import { DescriptionEditor } from './DescriptionEditor.tsx'

describe('DescriptionEditor', () => {
  it('edits markdown in write mode', async () => {
    // Arrange
    const user = userEvent.setup()
    const changes: string[] = []
    renderWithProviders(<DescriptionEditor value="" onChange={(next) => changes.push(next)} />)
    // Act — controlled input with a static parent: each keystroke reports one char
    await user.type(screen.getByRole('textbox'), '# Hi')
    // Assert
    expect(changes).toEqual(['#', ' ', 'H', 'i'])
  })

  it('renders the markdown preview via react-markdown', async () => {
    // Arrange
    const user = userEvent.setup()
    renderWithProviders(
      <DescriptionEditor value={'# Heading\n\n**bold** text'} onChange={() => undefined} />,
    )
    // Act
    await user.click(screen.getByRole('radio', { name: 'Preview' }))
    // Assert
    expect(screen.getByRole('heading', { name: 'Heading' })).toBeInTheDocument()
    expect(screen.getByText('bold')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('shows a hint when there is nothing to preview', async () => {
    // Arrange
    const user = userEvent.setup()
    renderWithProviders(<DescriptionEditor value="" onChange={() => undefined} />)
    // Act
    await user.click(screen.getByRole('radio', { name: 'Preview' }))
    // Assert
    expect(screen.getByText('Nothing to preview')).toBeInTheDocument()
  })
})
