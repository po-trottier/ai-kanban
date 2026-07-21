import { describe, expect, it } from 'vitest'
import { FixedClock, InMemoryDb, SequentialIdGenerator } from '@rivian-kanban/core/testing'
import { OAuthError } from './oauth-errors.ts'
import { RegistrationService } from './registration-service.ts'

function service() {
  const db = new InMemoryDb()
  const registration = new RegistrationService({
    uow: db,
    clock: new FixedClock(),
    ids: new SequentialIdGenerator(),
  })
  return { db, registration }
}

describe('RegistrationService.register', () => {
  it('registers a public client and persists it (token_endpoint_auth_method none)', async () => {
    // Arrange
    const { db, registration } = service()

    // Act
    const res = await registration.register({
      redirect_uris: ['https://app.example/cb', 'http://127.0.0.1:1455/cb'],
      client_name: 'Codex',
    })

    // Assert
    expect(res.client_id.length).toBeGreaterThan(0)
    expect(res.client_name).toBe('Codex')
    expect(res.token_endpoint_auth_method).toBe('none')
    const stored = await db.read((tx) => tx.oauthClients.findById(res.client_id))
    expect(stored?.redirectUris).toEqual(['https://app.example/cb', 'http://127.0.0.1:1455/cb'])
  })

  it('defaults the client name when omitted', async () => {
    // Arrange
    const { registration } = service()

    // Act
    const res = await registration.register({ redirect_uris: ['https://app.example/cb'] })

    // Assert — no client_name field echoed back, but a stored default name exists.
    expect(res.client_name).toBeUndefined()
  })

  it('rejects a non-https, non-loopback redirect URI', async () => {
    // Arrange
    const { registration } = service()

    // Act — plain http on a public host is not registrable.
    const act = registration.register({ redirect_uris: ['http://evil.example/cb'] })

    // Assert
    await expect(act).rejects.toBeInstanceOf(OAuthError)
    await expect(act).rejects.toMatchObject({ code: 'invalid_redirect_uri' })
  })

  it('rejects a custom scheme (only https/loopback allowed)', async () => {
    // Arrange
    const { registration } = service()

    // Act
    const act = registration.register({ redirect_uris: ['myapp://cb'] })

    // Assert
    await expect(act).rejects.toMatchObject({ code: 'invalid_redirect_uri' })
  })

  it('caps the redirect_uris array (open registration must not amplify storage)', async () => {
    // Arrange — 9 URIs exceeds the schema's max of 8.
    const { registration } = service()

    // Act
    const act = registration.register({
      redirect_uris: Array.from({ length: 9 }, (_, i) => `https://app.example/cb${String(i)}`),
    })

    // Assert — rejected at the schema boundary (before anything persists).
    await expect(act).rejects.toThrow()
  })
})
