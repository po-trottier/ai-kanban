import { describe, expect, it } from 'vitest'
import { DEFAULT_POLICY_DOCUMENT, policyDocumentSchema } from './policy.ts'

describe('policyDocumentSchema transitions', () => {
  it('hydrates existing policies with the default waiting reasons and validates edits', () => {
    // Arrange
    const old = { ...DEFAULT_POLICY_DOCUMENT, waitingReasons: undefined }
    // Act
    const hydrated = policyDocumentSchema.parse(old)
    // Assert
    expect(hydrated.waitingReasons).toEqual(DEFAULT_POLICY_DOCUMENT.waitingReasons)
    for (const waitingReasons of [
      [],
      [{ key: 'parts', label: 'Parts', active: false }],
      [{ key: 'parts', label: ' ', active: true }],
      [{ key: 'bad key', label: 'Reason', active: true }],
      [
        { key: 'parts', label: 'Parts', active: true },
        { key: 'parts', label: 'Other', active: true },
      ],
      [
        { key: 'parts', label: 'Parts', active: true },
        { key: 'other', label: ' parts ', active: true },
      ],
    ]) {
      expect(
        policyDocumentSchema.safeParse({ ...DEFAULT_POLICY_DOCUMENT, waitingReasons }).success,
      ).toBe(false)
    }
  })
  it('accepts the default workflow document', () => {
    // Arrange
    const doc = DEFAULT_POLICY_DOCUMENT
    // Act
    const result = policyDocumentSchema.safeParse(doc)
    // Assert
    expect(result.success).toBe(true)
  })

  it('defaults the business hours and rejects a day that ends before it starts', () => {
    // Arrange — the default day is 09:00–17:00; a start ≥ end must be refused.
    const backwards = { ...DEFAULT_POLICY_DOCUMENT, businessHours: { startHour: 17, endHour: 9 } }

    // Act
    const parsed = policyDocumentSchema.parse({
      ...DEFAULT_POLICY_DOCUMENT,
      businessHours: undefined,
    })
    const rejected = policyDocumentSchema.safeParse(backwards)

    // Assert
    expect(parsed.businessHours).toEqual({ startHour: 9, endHour: 17 })
    expect(rejected.success).toBe(false)
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
