import { describe, expect, it } from 'vitest'
import { etagOf, parseIfMatch } from './if-match.ts'

describe('parseIfMatch', () => {
  it('parses quoted, bare, weak, and padded entity-tags', () => {
    // Arrange
    const values = ['"3"', '3', 'W/"12"', '  "7"  ']

    // Act
    const versions = values.map(parseIfMatch)

    // Assert
    expect(versions).toEqual([3, 3, 12, 7])
  })

  it('rejects malformed and out-of-range values', () => {
    // Arrange
    const values = ['', 'abc', '"abc"', '"-1"', '"0"', '"1.5"', '*', '"3" , "4"']

    // Act
    const versions = values.map(parseIfMatch)

    // Assert
    expect(versions).toEqual([null, null, null, null, null, null, null, null])
  })
})

describe('etagOf', () => {
  it('formats the version as a quoted strong ETag', () => {
    // Arrange
    const version = 42

    // Act
    const etag = etagOf(version)

    // Assert
    expect(etag).toBe('"42"')
    expect(parseIfMatch(etag)).toBe(42)
  })
})
