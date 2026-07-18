import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import { DEFAULT_TIMEZONE } from './constants.ts'
import {
  cancelCardInputSchema,
  createCardInputSchema,
  moveCardInputSchema,
  pageRequestSchema,
  setupAdminInputSchema,
  updateCardInputSchema,
  updateProfileInputSchema,
} from './commands.ts'

const UUID = '10000000-0000-7000-8000-000000000001'

describe('createCardInputSchema', () => {
  it('applies the documented defaults for POST /cards', () => {
    // Arrange
    const body = { title: 'Fix door' }

    // Act
    const input = createCardInputSchema.parse(body)

    // Assert
    expect(input.description).toBe('')
    expect(input.priority).toBe('P2')
    expect(input.tags).toEqual([])
    expect(input.assigneeId).toBeUndefined()
  })

  it('rejects unknown keys (strict schemas)', () => {
    // Arrange
    const body = { title: 'Fix door', sneaky: true }

    // Act
    const act = () => createCardInputSchema.parse(body)

    // Assert
    expect(act).toThrow(ZodError)
  })

  it('rejects a client-supplied reporterId (reporter = acting user)', () => {
    // Arrange
    const body = { title: 'Fix door', reporterId: UUID }

    // Act
    const act = () => createCardInputSchema.parse(body)

    // Assert
    expect(act).toThrow(ZodError)
  })

  it('rejects a title over 200 characters', () => {
    // Arrange
    const body = { title: 'x'.repeat(201) }

    // Act
    const act = () => createCardInputSchema.parse(body)

    // Assert
    expect(act).toThrow(ZodError)
  })

  it('trims tag names and the title', () => {
    // Arrange
    const body = { title: '  Fix door  ', tags: [' hvac '] }

    // Act
    const input = createCardInputSchema.parse(body)

    // Assert
    expect(input.title).toBe('Fix door')
    expect(input.tags).toEqual(['hvac'])
  })
})

describe('updateCardInputSchema', () => {
  it('requires expectedVersion (optimistic lock in the contract)', () => {
    // Arrange
    const body = { title: 'New title' }

    // Act
    const act = () => updateCardInputSchema.parse(body)

    // Assert
    expect(act).toThrow(ZodError)
  })

  it('accepts explicit nulls to clear assignee, location, and estimate', () => {
    // Arrange
    const body = { assigneeId: null, locationId: null, estimateMinutes: null, expectedVersion: 3 }

    // Act
    const input = updateCardInputSchema.parse(body)

    // Assert
    expect(input.assigneeId).toBeNull()
    expect(input.locationId).toBeNull()
    expect(input.estimateMinutes).toBeNull()
  })
})

describe('moveCardInputSchema', () => {
  it('defaults absent neighbors to null and requires toLane + expectedVersion', () => {
    // Arrange
    const body = { toLane: 'ready', expectedVersion: 1 }

    // Act
    const input = moveCardInputSchema.parse(body)

    // Assert
    expect(input.prevCardId).toBeNull()
    expect(input.nextCardId).toBeNull()
    expect(input.toLane).toBe('ready')
  })

  it('rejects an unknown lane key', () => {
    // Arrange
    const body = { toLane: 'trash', expectedVersion: 1 }

    // Act
    const act = () => moveCardInputSchema.parse(body)

    // Assert
    expect(act).toThrow(ZodError)
  })

  it('accepts waiting-lane fields with a date-only expectedResumeAt', () => {
    // Arrange
    const body = {
      toLane: 'waiting_parts_vendor',
      prevCardId: 42,
      waitingReason: 'parts',
      expectedResumeAt: '2026-08-01',
      expectedVersion: 2,
    }

    // Act
    const input = moveCardInputSchema.parse(body)

    // Assert
    expect(input.waitingReason).toBe('parts')
    expect(input.expectedResumeAt).toBe('2026-08-01')
  })

  it('rejects a timestamp where a date-only resume date is required', () => {
    // Arrange
    const body = {
      toLane: 'waiting_parts_vendor',
      expectedResumeAt: '2026-08-01T00:00:00.000Z',
      waitingReason: 'parts',
      expectedVersion: 2,
    }

    // Act
    const act = () => moveCardInputSchema.parse(body)

    // Assert
    expect(act).toThrow(ZodError)
  })
})

describe('cancelCardInputSchema', () => {
  it('rejects the system-only resolution `completed`', () => {
    // Arrange
    const body = { resolution: 'completed', expectedVersion: 1 }

    // Act
    const act = () => cancelCardInputSchema.parse(body)

    // Assert
    expect(act).toThrow(ZodError)
  })

  it('accepts the explicit cancel resolutions', () => {
    // Arrange
    const body = { resolution: 'duplicate', expectedVersion: 1 }

    // Act
    const input = cancelCardInputSchema.parse(body)

    // Assert
    expect(input.resolution).toBe('duplicate')
  })
})

describe('pageRequestSchema', () => {
  it('defaults the limit to 50', () => {
    // Arrange
    const query = {}

    // Act
    const page = pageRequestSchema.parse(query)

    // Assert
    expect(page.limit).toBe(50)
    expect(page.cursor).toBeUndefined()
  })

  it('rejects limits above the 200 maximum', () => {
    // Arrange
    const query = { limit: 201 }

    // Act
    const act = () => pageRequestSchema.parse(query)

    // Assert
    expect(act).toThrow(ZodError)
  })
})

describe('setupAdminInputSchema time zone', () => {
  it('defaults an omitted time zone to PST', () => {
    // Arrange
    const body = { email: 'admin@org.example', displayName: 'Admin', password: 'x'.repeat(12) }

    // Act
    const input = setupAdminInputSchema.parse(body)

    // Assert
    expect(input.timezone).toBe(DEFAULT_TIMEZONE)
  })

  it('accepts a valid IANA zone and rejects an unknown one', () => {
    // Arrange
    const base = { email: 'admin@org.example', displayName: 'Admin', password: 'x'.repeat(12) }

    // Act
    const ok = setupAdminInputSchema.parse({ ...base, timezone: 'America/New_York' })
    const bad = () => setupAdminInputSchema.parse({ ...base, timezone: 'Nowhere/Void' })

    // Assert
    expect(ok.timezone).toBe('America/New_York')
    expect(bad).toThrow(ZodError)
  })
})

describe('updateProfileInputSchema', () => {
  it('accepts a valid time zone and theme together', () => {
    // Arrange
    const body = { timezone: 'Europe/Paris', theme: 'dark' }

    // Act
    const input = updateProfileInputSchema.parse(body)

    // Assert
    expect(input.timezone).toBe('Europe/Paris')
    expect(input.theme).toBe('dark')
  })

  it('rejects an unknown theme value', () => {
    // Arrange
    const body = { timezone: 'UTC', theme: 'neon' }

    // Act
    const act = () => updateProfileInputSchema.parse(body)

    // Assert
    expect(act).toThrow(ZodError)
  })

  it('rejects any field other than the display prefs (no privilege escalation)', () => {
    // Arrange — a mass-assignment attempt with an extra role key
    const body = { timezone: 'UTC', theme: 'system', role: 'admin' }

    // Act
    const act = () => updateProfileInputSchema.parse(body)

    // Assert
    expect(act).toThrow(ZodError)
  })
})
