import { describe, expect, it } from 'vitest'
import { DEFAULT_POLICY_DOCUMENT, policyDocumentSchema } from './policy.ts'

describe('policyDocumentSchema transitions', () => {
  it('accepts the default workflow document', () => {
    // Arrange
    const doc = DEFAULT_POLICY_DOCUMENT
    // Act
    const result = policyDocumentSchema.safeParse(doc)
    // Assert
    expect(result.success).toBe(true)
  })

  it('rejects a transition that loops a lane to itself', () => {
    // Arrange
    const doc = { ...DEFAULT_POLICY_DOCUMENT, transitions: [{ from: 'ready', to: 'ready' }] }
    // Act
    const result = policyDocumentSchema.safeParse(doc)
    // Assert
    expect(result.success).toBe(false)
  })

  it('rejects a duplicate transition edge', () => {
    // Arrange
    const doc = {
      ...DEFAULT_POLICY_DOCUMENT,
      transitions: [
        { from: 'intake', to: 'ready' },
        { from: 'intake', to: 'ready' },
      ],
    }
    // Act
    const result = policyDocumentSchema.safeParse(doc)
    // Assert
    expect(result.success).toBe(false)
  })
})
