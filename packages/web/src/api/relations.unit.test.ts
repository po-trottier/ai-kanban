import { describe, expect, it } from 'vitest'
import { cardSearchTerm } from './relations.ts'

describe('cardSearchTerm', () => {
  it('collapses a pasted card URL to its work-order number', () => {
    // Arrange
    const url = 'https://kanban.example.com/cards/42?filter=x'
    // Act
    const term = cardSearchTerm(url)
    // Assert
    expect(term).toBe('42')
  })

  it('collapses a "#42" ticket ref to the bare number', () => {
    // Arrange
    const ref = '#42'
    // Act
    const term = cardSearchTerm(ref)
    // Assert
    expect(term).toBe('42')
  })

  it('leaves a bare number as-is (the server matches it as an id or text)', () => {
    // Arrange
    const number = '42'
    // Act
    const term = cardSearchTerm(number)
    // Assert
    expect(term).toBe('42')
  })

  it('passes a title through, trimmed', () => {
    // Arrange
    const title = '  Broken door  '
    // Act
    const term = cardSearchTerm(title)
    // Assert
    expect(term).toBe('Broken door')
  })
})
