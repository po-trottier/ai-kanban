import { describe, expect, it } from 'vitest'
import {
  findMatchingRedirectUri,
  isLoopbackRedirectUri,
  redirectUriMatches,
} from './redirect-match.ts'

describe('isLoopbackRedirectUri', () => {
  it('recognizes 127.0.0.1, localhost, and [::1] over http', () => {
    // Arrange
    const uris = ['http://127.0.0.1:1234/cb', 'http://localhost/cb', 'http://[::1]:9999/cb']

    // Act
    const results = uris.map(isLoopbackRedirectUri)

    // Assert
    expect(results).toEqual([true, true, true])
  })

  it('is false for https and for non-loopback hosts', () => {
    // Arrange — an https loopback is not "the port-ignoring case"; a public host never is.
    const uris = ['https://127.0.0.1/cb', 'http://example.com/cb']

    // Act
    const results = uris.map(isLoopbackRedirectUri)

    // Assert
    expect(results).toEqual([false, false])
  })

  it('is false for an unparseable URI', () => {
    // Arrange
    const uri = 'not a uri'

    // Act
    const result = isLoopbackRedirectUri(uri)

    // Assert
    expect(result).toBe(false)
  })
})

describe('redirectUriMatches', () => {
  it('matches an https callback only byte-exact', () => {
    // Arrange
    const registered = 'https://app.example/cb'

    // Act
    const exact = redirectUriMatches(registered, 'https://app.example/cb')
    const different = redirectUriMatches(registered, 'https://app.example/other')

    // Assert
    expect(exact).toBe(true)
    expect(different).toBe(false)
  })

  it('matches loopback ignoring the port (ephemeral agent ports)', () => {
    // Arrange — Claude Code/Codex register one port, redirect on another.
    // Act
    const ip = redirectUriMatches('http://127.0.0.1:1111/cb', 'http://127.0.0.1:52345/cb')
    const named = redirectUriMatches('http://localhost/cb', 'http://localhost:8080/cb')

    // Assert
    expect(ip).toBe(true)
    expect(named).toBe(true)
  })

  it('still requires the loopback PATH to match exactly', () => {
    // Arrange — only the port is ignored; a different path never matches.
    // Act
    const result = redirectUriMatches('http://127.0.0.1:1111/cb', 'http://127.0.0.1:2222/evil')

    // Assert
    expect(result).toBe(false)
  })

  it('does not treat a loopback vs public host as a match', () => {
    // Arrange — one side loopback, the other not ⇒ exact-only ⇒ no match.
    // Act
    const result = redirectUriMatches('http://127.0.0.1:1111/cb', 'http://evil.example:1111/cb')

    // Assert
    expect(result).toBe(false)
  })

  it('falls back to exact equality when a side is unparseable', () => {
    // Arrange
    const registered = 'weird'

    // Act
    const same = redirectUriMatches(registered, 'weird')
    const other = redirectUriMatches(registered, 'other')

    // Assert
    expect(same).toBe(true)
    expect(other).toBe(false)
  })
})

describe('findMatchingRedirectUri', () => {
  it('returns the registered URI that matches, or null', () => {
    // Arrange
    const registered = ['https://app.example/cb', 'http://127.0.0.1:1111/cb']

    // Act — the loopback entry matches a different-port candidate.
    const loopback = findMatchingRedirectUri(registered, 'http://127.0.0.1:60000/cb')
    const https = findMatchingRedirectUri(registered, 'https://app.example/cb')
    const none = findMatchingRedirectUri(registered, 'https://evil.example/cb')

    // Assert
    expect(loopback).toBe('http://127.0.0.1:1111/cb')
    expect(https).toBe('https://app.example/cb')
    expect(none).toBeNull()
  })
})
