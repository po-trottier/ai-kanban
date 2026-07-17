import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '../test/render.tsx'
import { ErrorBoundary } from './ErrorBoundary.tsx'

function Bomb(): never {
  throw new Error('render exploded')
}

describe('ErrorBoundary', () => {
  it('renders children while nothing throws', () => {
    // Arrange
    const content = <p>All good</p>
    // Act
    renderWithProviders(<ErrorBoundary>{content}</ErrorBoundary>)
    // Assert
    expect(screen.getByText('All good')).toBeInTheDocument()
  })

  it('replaces a crashed subtree with the reload prompt', () => {
    // Arrange
    const ui = (
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    )
    // Act
    renderWithProviders(ui)
    // Assert
    expect(screen.getByText('Something went wrong. Please try again.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
  })
})
