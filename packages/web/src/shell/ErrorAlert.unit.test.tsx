import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/problem.ts'
import { renderWithProviders } from '../test/render.tsx'
import { ErrorAlert } from './ErrorAlert.tsx'

describe('ErrorAlert', () => {
  it('renders problem+json title and detail (RFC 9457)', () => {
    // Arrange
    const error = new ApiError(422, {
      type: 'https://example.com/illegal-transition',
      title: 'Illegal transition',
      status: 422,
      detail: 'intake → done is not a workflow edge',
    })
    // Act
    renderWithProviders(<ErrorAlert error={error} />)
    // Assert
    expect(screen.getByText('Illegal transition')).toBeInTheDocument()
    expect(screen.getByText('intake → done is not a workflow edge')).toBeInTheDocument()
  })

  it('lists validation issues from a 400 problem (string paths, as the server emits)', () => {
    // Arrange — paths are joined strings on the wire (core problemDetailsSchema)
    const error = new ApiError(400, {
      title: 'Validation failed',
      status: 400,
      issues: [
        { path: 'body.title', message: 'Required' },
        { path: 'estimateMinutes', message: 'Must be positive' },
      ],
    })
    // Act
    renderWithProviders(<ErrorAlert error={error} />)
    // Assert
    expect(screen.getByText('Some fields need attention:')).toBeInTheDocument()
    expect(screen.getByText('body.title: Required')).toBeInTheDocument()
    expect(screen.getByText('estimateMinutes: Must be positive')).toBeInTheDocument()
  })

  it('falls back to a generic message for unknown errors', () => {
    // Arrange
    const error = new Error('boom')
    // Act
    renderWithProviders(<ErrorAlert error={error} />)
    // Assert
    expect(screen.getByText('Something went wrong. Please try again.')).toBeInTheDocument()
    expect(screen.getByText('boom')).toBeInTheDocument()
  })
})
