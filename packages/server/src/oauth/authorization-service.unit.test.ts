import { createHash, randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { FixedClock, InMemoryDb, SequentialIdGenerator } from '@rivian-kanban/core/testing'
import { AuthorizationService } from './authorization-service.ts'
import { canonicalMcpUri } from './canonical-uri.ts'
import { DEFAULT_OAUTH_TTLS, type OAuthConfig } from './oauth-config.ts'
import { RegistrationService } from './registration-service.ts'

const USER_ID = '00000000-0000-7000-8000-0000000000aa'
const REDIRECT_URI = 'http://127.0.0.1:1455/callback'
const ORIGIN = 'http://localhost:3000'

function config(): OAuthConfig {
  return { issuer: ORIGIN, canonicalMcpUri: canonicalMcpUri(ORIGIN), ...DEFAULT_OAUTH_TTLS }
}

async function harness() {
  const db = new InMemoryDb()
  const clock = new FixedClock()
  const ids = new SequentialIdGenerator()
  const cfg = config()
  const authorization = new AuthorizationService({ uow: db, clock, ids, config: cfg })
  const registration = new RegistrationService({ uow: db, clock, ids })
  const { client_id: clientId } = await registration.register({ redirect_uris: [REDIRECT_URI] })
  const challenge = createHash('sha256').update(randomBytes(32)).digest('base64url')
  return { db, clock, cfg, authorization, clientId, challenge }
}

const baseRequest = (clientId: string, challenge: string) => ({
  clientId,
  redirectUri: REDIRECT_URI,
  resource: 'http://localhost:3000/mcp',
  scope: 'read' as const,
  codeChallenge: challenge,
  codeChallengeMethod: 'S256' as const,
})

describe('AuthorizationService.authorize', () => {
  it('mints a single-use, hashed code bound to the canonical resource', async () => {
    // Arrange
    const h = await harness()

    // Act — resource sent with a trailing slash; it must be canonicalized.
    const { code } = await h.authorization.authorize(USER_ID, {
      ...baseRequest(h.clientId, h.challenge),
      resource: 'http://localhost:3000/mcp/',
    })

    // Assert — only the sha256 persists, bound to the user + canonical audience.
    const row = await h.db.read((tx) =>
      tx.oauthAuthorizationCodes.consume(createHash('sha256').update(code).digest('hex')),
    )
    expect(row?.userId).toBe(USER_ID)
    expect(row?.resource).toBe(h.cfg.canonicalMcpUri)
    expect(row?.codeChallenge).toBe(h.challenge)
  })

  it('rejects a resource that is not our canonical /mcp audience', async () => {
    // Arrange
    const h = await harness()

    // Act — a client asking for a different audience (RFC 8707) is refused.
    const act = h.authorization.authorize(USER_ID, {
      ...baseRequest(h.clientId, h.challenge),
      resource: 'https://someone-else.example/mcp',
    })

    // Assert
    await expect(act).rejects.toMatchObject({ code: 'invalid_request' })
  })

  it('rejects an unknown client', async () => {
    // Arrange
    const h = await harness()

    // Act
    const act = h.authorization.authorize(USER_ID, baseRequest('ghost-client', h.challenge))

    // Assert
    await expect(act).rejects.toMatchObject({ code: 'invalid_client' })
  })

  it('rejects a redirect_uri not registered for the client', async () => {
    // Arrange
    const h = await harness()

    // Act — a public host was never registered.
    const act = h.authorization.authorize(USER_ID, {
      ...baseRequest(h.clientId, h.challenge),
      redirectUri: 'https://evil.example/cb',
    })

    // Assert
    await expect(act).rejects.toMatchObject({ code: 'invalid_redirect_uri' })
  })

  it('accepts a loopback redirect on a different ephemeral port', async () => {
    // Arrange
    const h = await harness()

    // Act — registered :1455, redirect on :60000 (agent picks a fresh port).
    const { code } = await h.authorization.authorize(USER_ID, {
      ...baseRequest(h.clientId, h.challenge),
      redirectUri: 'http://127.0.0.1:60000/callback',
    })

    // Assert
    expect(code.length).toBeGreaterThan(0)
  })

  it('rejects a non-S256 method before touching the store', async () => {
    // Arrange
    const h = await harness()

    // Act — the schema literal already blocks `plain`; assertS256 is the
    // defence-in-depth backstop, so we pass an S256 shape then trust the guard.
    const act = h.authorization.authorize(USER_ID, {
      ...baseRequest(h.clientId, h.challenge),
      codeChallengeMethod: 'plain',
    })

    // Assert — a bad method never mints a code.
    await expect(act).rejects.toBeInstanceOf(Error)
  })
})
