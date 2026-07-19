import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '../test/render.tsx'
import { renderCommentBody } from './renderMentions.tsx'

const names = ['Terry Tech', 'Terry', 'Ada Admin']

describe('renderCommentBody', () => {
  it('wraps a known multi-word @mention in a styled tag (longest name wins)', () => {
    // Arrange
    const body = 'ping @Terry Tech about the pump'
    // Act
    renderWithProviders(<p>{renderCommentBody(body, names)}</p>)
    // Assert — the whole "@Terry Tech" is one tag, not just "@Terry".
    const tag = screen.getByText('@Terry Tech')
    expect(tag.tagName).toBe('SPAN')
    expect(screen.queryByText('@Terry', { exact: true })).not.toBeInTheDocument()
  })

  it('leaves an unknown @handle as plain text', () => {
    // Arrange
    const body = 'cc @foo please'
    // Act
    renderWithProviders(<p>{renderCommentBody(body, names)}</p>)
    // Assert — no span tag; the run stays part of the surrounding plain text.
    expect(screen.queryByText('@foo')).not.toBeInTheDocument()
    expect(screen.getByText('cc @foo please')).toBeInTheDocument()
  })

  it('returns text without an @ unchanged', () => {
    // Arrange
    const body = 'no mentions here'
    // Act — no rendering: assert on the returned nodes directly.
    // Assert — a single plain string node, nothing wrapped in a tag.
    expect(renderCommentBody(body, names)).toEqual(['no mentions here'])
  })
})
