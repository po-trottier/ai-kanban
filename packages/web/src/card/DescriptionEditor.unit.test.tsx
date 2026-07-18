import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '../test/render.tsx'
import { DescriptionEditor } from './DescriptionEditor.tsx'

describe('DescriptionEditor', () => {
  it('renders the markdown value as rich text in a labelled editor', async () => {
    // Arrange
    const markdown = '# Heading\n\n**bold** text'
    // Act
    renderWithProviders(<DescriptionEditor value={markdown} onChange={() => undefined} />)
    // Assert — a labelled editable region, with the markdown rendered (not raw)
    const editor = await screen.findByRole('textbox', { name: 'Description' })
    expect(editor).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Heading' })).toBeInTheDocument()
    expect(screen.getByText('bold')).toBeInTheDocument()
  })

  it('explains the field with an info tooltip on the label', () => {
    // Arrange
    const onChange = () => undefined
    // Act
    renderWithProviders(<DescriptionEditor value="" onChange={onChange} />)
    // Assert — the FieldLabel info button carries the help copy as its name.
    expect(screen.getByRole('button', { name: /full details of the work/ })).toBeInTheDocument()
  })

  it('offers formatting controls in the toolbar', async () => {
    // Arrange
    const onChange = () => undefined
    // Act
    renderWithProviders(<DescriptionEditor value="" onChange={onChange} />)
    // Assert — Mantine RichTextEditor renders labelled control buttons
    expect(await screen.findByRole('button', { name: /bold/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /bullet list/i })).toBeInTheDocument()
  })

  it('is read-only when disabled', async () => {
    // Arrange
    const onChange = () => undefined
    // Act
    renderWithProviders(<DescriptionEditor value="locked" disabled onChange={onChange} />)
    // Assert — the editable region is not editable
    const editor = await screen.findByRole('textbox', { name: 'Description' })
    expect(editor).toHaveAttribute('contenteditable', 'false')
  })
})
