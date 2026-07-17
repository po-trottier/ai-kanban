import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import { decodeCursor, encodeCursor } from './cursor.ts'

/**
 * Known-vector tokens precomputed with standard tooling —
 * `Buffer.from(json).toString('base64url')` on Node 24 — so the codec (btoa/
 * atob platform globals; core imports no node builtins) is pinned to RFC 4648
 * base64url rather than merely round-tripping against itself.
 */
const KNOWN_KEY = {
  createdAt: '2026-07-16T12:34:56.789Z',
  id: '01890000-0000-7000-8000-000000000001',
}
// Buffer.from(JSON.stringify(KNOWN_KEY)).toString('base64url')
const KNOWN_TOKEN =
  'eyJjcmVhdGVkQXQiOiIyMDI2LTA3LTE2VDEyOjM0OjU2Ljc4OVoiLCJpZCI6IjAxODkwMDAwLTAwMDAtNzAwMC04MDAwLTAwMDAwMDAwMDAwMSJ9'
// Buffer.from('{"foo":1}').toString('base64url')
const NOT_A_CURSOR_TOKEN = 'eyJmb28iOjF9'
// Buffer.from('{"createdAt":"yesterday","id":"01890000-0000-7000-8000-000000000001"}').toString('base64url')
const BAD_TIMESTAMP_TOKEN =
  'eyJjcmVhdGVkQXQiOiJ5ZXN0ZXJkYXkiLCJpZCI6IjAxODkwMDAwLTAwMDAtNzAwMC04MDAwLTAwMDAwMDAwMDAwMSJ9'

describe('cursor codec', () => {
  it('encodes to the standard base64url token (known vector)', () => {
    // Arrange
    const key = KNOWN_KEY

    // Act
    const token = encodeCursor(key)

    // Assert
    expect(token).toBe(KNOWN_TOKEN)
  })

  it('decodes the standard base64url token back to the key (known vector)', () => {
    // Arrange
    const token = KNOWN_TOKEN

    // Act
    const decoded = decodeCursor(token)

    // Assert
    expect(decoded).toEqual(KNOWN_KEY)
  })

  it('round-trips a keyset cursor', () => {
    // Arrange
    const key = {
      createdAt: '2026-07-16T12:34:56.789Z',
      id: '01890000-0000-7000-8000-000000000001',
    }

    // Act
    const decoded = decodeCursor(encodeCursor(key))

    // Assert
    expect(decoded).toEqual(key)
  })

  it('produces an opaque base64url token without padding or unsafe characters', () => {
    // Arrange
    const key = {
      createdAt: '2026-07-16T00:00:00.000Z',
      id: '01890000-0000-7000-8000-0000000000ff',
    }

    // Act
    const token = encodeCursor(key)

    // Assert
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('rejects garbage that is not base64url JSON', () => {
    // Arrange
    const token = '!!!not-a-cursor!!!'

    // Act
    const act = () => decodeCursor(token)

    // Assert
    expect(act).toThrow(ZodError)
  })

  it('rejects well-formed JSON that is not a cursor key', () => {
    // Arrange
    const token = NOT_A_CURSOR_TOKEN

    // Act
    const act = () => decodeCursor(token)

    // Assert
    expect(act).toThrow(ZodError)
  })

  it('rejects a cursor with a malformed timestamp', () => {
    // Arrange
    const token = BAD_TIMESTAMP_TOKEN

    // Act
    const act = () => decodeCursor(token)

    // Assert
    expect(act).toThrow(ZodError)
  })
})
