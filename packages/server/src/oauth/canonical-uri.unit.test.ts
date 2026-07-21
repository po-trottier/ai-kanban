import { describe, expect, it } from 'vitest'
import { canonicalizeResource, canonicalMcpUri } from './canonical-uri.ts'

describe('canonicalizeResource', () => {
  it('lowercases scheme and host but preserves the path case', () => {
    // Arrange
    const uri = 'HTTPS://App.Example.COM/Mcp'

    // Act
    const out = canonicalizeResource(uri)

    // Assert
    expect(out).toBe('https://app.example.com/Mcp')
  })

  it('strips a trailing slash off a non-root path', () => {
    // Arrange — `…/mcp/` and `…/mcp` must canonicalize to the same audience.
    const withSlash = 'https://x.example/mcp/'
    const without = 'https://x.example/mcp'

    // Act
    const a = canonicalizeResource(withSlash)
    const b = canonicalizeResource(without)

    // Assert
    expect(a).toBe('https://x.example/mcp')
    expect(b).toBe('https://x.example/mcp')
  })

  it('drops the fragment', () => {
    // Arrange
    const uri = 'https://x.example/mcp#frag'

    // Act
    const out = canonicalizeResource(uri)

    // Assert
    expect(out).toBe('https://x.example/mcp')
  })

  it('leaves a bare origin consistent regardless of trailing slash', () => {
    // Arrange
    const withSlash = 'https://x.example/'
    const without = 'https://x.example'

    // Act
    const a = canonicalizeResource(without)
    const b = canonicalizeResource(withSlash)

    // Assert — both origin spellings land on the same value.
    expect(a).toBe(b)
  })

  it('returns an unparseable value unchanged (still compared verbatim)', () => {
    // Arrange
    const uri = 'not-a-uri'

    // Act
    const out = canonicalizeResource(uri)

    // Assert
    expect(out).toBe('not-a-uri')
  })
})

describe('canonicalMcpUri', () => {
  it('appends /mcp to the origin and canonicalizes, tolerating a trailing slash', () => {
    // Arrange
    const origins = ['http://localhost:3000', 'http://localhost:3000/']

    // Act
    const results = origins.map(canonicalMcpUri)

    // Assert — the two PUBLIC_BASE_URL spellings yield the identical audience.
    expect(results).toEqual(['http://localhost:3000/mcp', 'http://localhost:3000/mcp'])
  })
})
