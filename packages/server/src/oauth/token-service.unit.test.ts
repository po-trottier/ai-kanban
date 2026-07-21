import { createHash, randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { FixedClock, InMemoryDb, SequentialIdGenerator } from '@rivian-kanban/core/testing'
import { AuthorizationService } from './authorization-service.ts'
import { canonicalMcpUri } from './canonical-uri.ts'
import { DEFAULT_OAUTH_TTLS, type OAuthConfig } from './oauth-config.ts'
import { OAuthError } from './oauth-errors.ts'
import { RegistrationService } from './registration-service.ts'
import { TokenService } from './token-service.ts'

/**
 * TokenService over the in-memory UnitOfWork (docs/dev/testing.md). Covers the
 * security invariants: happy-path code→token, PKCE mismatch, single-use code,
 * refresh rotation, and refresh REPLAY ⇒ family revoked.
 */

const USER_ID = '00000000-0000-7000-8000-0000000000aa'
const REDIRECT_URI = 'http://127.0.0.1:1455/callback'
const ORIGIN = 'http://localhost:3000'

/** A PKCE verifier + its S256 challenge (RFC 7636). */
function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

function makeConfig(): OAuthConfig {
  return {
    issuer: ORIGIN,
    canonicalMcpUri: canonicalMcpUri(ORIGIN),
    ...DEFAULT_OAUTH_TTLS,
  }
}

interface Harness {
  db: InMemoryDb
  clock: FixedClock
  config: OAuthConfig
  tokens: TokenService
  authorization: AuthorizationService
  clientId: string
  /** Registers a client + mints a fresh authorization code, returning it with its verifier. */
  freshCode(scope?: 'read' | 'read_write'): Promise<{ code: string; verifier: string }>
}

async function harness(): Promise<Harness> {
  const db = new InMemoryDb()
  const clock = new FixedClock()
  const ids = new SequentialIdGenerator()
  const config = makeConfig()
  const deps = { uow: db, clock, ids, config }
  const registration = new RegistrationService({ uow: db, clock, ids })
  const authorization = new AuthorizationService(deps)
  const tokens = new TokenService(deps)

  const registered = await registration.register({
    redirect_uris: [REDIRECT_URI],
    client_name: 'Test Agent',
  })
  const clientId = registered.client_id

  const freshCode: Harness['freshCode'] = async (scope = 'read_write') => {
    const { verifier, challenge } = pkcePair()
    const { code } = await authorization.authorize(USER_ID, {
      clientId,
      redirectUri: REDIRECT_URI,
      resource: config.canonicalMcpUri,
      scope,
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
    })
    return { code, verifier }
  }

  return { db, clock, config, tokens, authorization, clientId, freshCode }
}

describe('TokenService — authorization_code grant', () => {
  it('happy path: exchanges code + verifier for an access + refresh token bound to /mcp', async () => {
    // Arrange
    const h = await harness()
    const { code, verifier } = await h.freshCode('read_write')

    // Act
    const response = await h.tokens.token({
      grantType: 'authorization_code',
      code,
      codeVerifier: verifier,
      clientId: h.clientId,
      redirectUri: REDIRECT_URI,
    })

    // Assert — RFC 6749 §5.1 shape, opaque prefixes, and the audience.
    expect(response.token_type).toBe('Bearer')
    expect(response.scope).toBe('read_write')
    expect(response.expires_in).toBe(DEFAULT_OAUTH_TTLS.accessTokenTtlMs / 1000)
    expect(response.access_token.startsWith('rka_')).toBe(true)
    expect(response.refresh_token.startsWith('rkr_')).toBe(true)
    // The minted access token carries the canonical /mcp audience.
    const stored = await h.db.read((tx) =>
      tx.oauthAccessTokens.findByHash(
        createHash('sha256').update(response.access_token).digest('hex'),
      ),
    )
    expect(stored?.resource).toBe(h.config.canonicalMcpUri)
    expect(stored?.userId).toBe(USER_ID)
  })

  it('rejects a PKCE mismatch (wrong verifier) with invalid_grant', async () => {
    // Arrange
    const h = await harness()
    const { code } = await h.freshCode()

    // Act
    const act = h.tokens.token({
      grantType: 'authorization_code',
      code,
      codeVerifier: 'a-wrong-verifier',
      clientId: h.clientId,
      redirectUri: REDIRECT_URI,
    })

    // Assert
    await expect(act).rejects.toBeInstanceOf(OAuthError)
    await expect(act).rejects.toMatchObject({ code: 'invalid_grant' })
  })

  it('rejects when the redirect_uri does not match the code', async () => {
    // Arrange
    const h = await harness()
    const { code, verifier } = await h.freshCode()

    // Act — a different (but same-loopback) URI is still a mismatch: the code
    // binds the EXACT redirect it was issued with.
    const act = h.tokens.token({
      grantType: 'authorization_code',
      code,
      codeVerifier: verifier,
      clientId: h.clientId,
      redirectUri: 'http://127.0.0.1:1455/other',
    })

    // Assert
    await expect(act).rejects.toMatchObject({ code: 'invalid_grant' })
  })

  it('burns the code even on a FAILED exchange (no PKCE brute-force retry)', async () => {
    // Arrange — first attempt fails PKCE.
    const h = await harness()
    const { code, verifier } = await h.freshCode()
    await expect(
      h.tokens.token({
        grantType: 'authorization_code',
        code,
        codeVerifier: 'wrong-verifier',
        clientId: h.clientId,
        redirectUri: REDIRECT_URI,
      }),
    ).rejects.toMatchObject({ code: 'invalid_grant' })

    // Act — retry the SAME code with the CORRECT verifier.
    const retry = h.tokens.token({
      grantType: 'authorization_code',
      code,
      codeVerifier: verifier,
      clientId: h.clientId,
      redirectUri: REDIRECT_URI,
    })

    // Assert — the code was consumed by the failed attempt; the retry fails.
    await expect(retry).rejects.toMatchObject({ code: 'invalid_grant' })
  })

  it('is single-use: a second exchange of the same code fails', async () => {
    // Arrange
    const h = await harness()
    const { code, verifier } = await h.freshCode()
    const exchange = () =>
      h.tokens.token({
        grantType: 'authorization_code',
        code,
        codeVerifier: verifier,
        clientId: h.clientId,
        redirectUri: REDIRECT_URI,
      })

    // Act — first succeeds, second must fail (code consumed).
    await exchange()
    const second = exchange()

    // Assert
    await expect(second).rejects.toMatchObject({ code: 'invalid_grant' })
  })

  it('rejects an expired code', async () => {
    // Arrange
    const h = await harness()
    const { code, verifier } = await h.freshCode()

    // Act — advance past the 60 s code TTL.
    h.clock.advanceDays(1)
    const act = h.tokens.token({
      grantType: 'authorization_code',
      code,
      codeVerifier: verifier,
      clientId: h.clientId,
      redirectUri: REDIRECT_URI,
    })

    // Assert
    await expect(act).rejects.toMatchObject({ code: 'invalid_grant' })
  })
})

describe('TokenService — refresh_token grant', () => {
  /** Runs the code grant and returns the issued refresh token. */
  async function issueRefresh(h: Harness): Promise<string> {
    const { code, verifier } = await h.freshCode()
    const res = await h.tokens.token({
      grantType: 'authorization_code',
      code,
      codeVerifier: verifier,
      clientId: h.clientId,
      redirectUri: REDIRECT_URI,
    })
    return res.refresh_token
  }

  it('rotates: a new access + refresh are issued and the old refresh is invalidated', async () => {
    // Arrange
    const h = await harness()
    const first = await issueRefresh(h)

    // Act — rotate WITHOUT sending resource (Codex omits it; audience from the row).
    const rotated = await h.tokens.token({
      grantType: 'refresh_token',
      refreshToken: first,
      clientId: h.clientId,
    })

    // Assert — a fresh, different refresh token comes back...
    expect(rotated.refresh_token.startsWith('rkr_')).toBe(true)
    expect(rotated.refresh_token).not.toBe(first)
    expect(rotated.access_token.startsWith('rka_')).toBe(true)

    // ...and reusing the OLD refresh now fails (it was rotated/spent).
    const reuseOld = h.tokens.token({
      grantType: 'refresh_token',
      refreshToken: first,
      clientId: h.clientId,
    })
    await expect(reuseOld).rejects.toMatchObject({ code: 'invalid_grant' })
  })

  it('binds the audience from the stored row when resource is omitted', async () => {
    // Arrange
    const h = await harness()
    const first = await issueRefresh(h)

    // Act
    const rotated = await h.tokens.token({
      grantType: 'refresh_token',
      refreshToken: first,
      clientId: h.clientId,
    })

    // Assert — the new access token still targets the canonical /mcp audience.
    const stored = await h.db.read((tx) =>
      tx.oauthAccessTokens.findByHash(
        createHash('sha256').update(rotated.access_token).digest('hex'),
      ),
    )
    expect(stored?.resource).toBe(h.config.canonicalMcpUri)
  })

  it('REPLAY: reusing a spent refresh revokes the whole family and its access tokens', async () => {
    // Arrange — one legit rotation, so `first` is now spent.
    const h = await harness()
    const first = await issueRefresh(h)
    const second = await h.tokens.token({
      grantType: 'refresh_token',
      refreshToken: first,
      clientId: h.clientId,
    })

    // Act — replay the SPENT `first` refresh token (theft signature).
    const replay = h.tokens.token({
      grantType: 'refresh_token',
      refreshToken: first,
      clientId: h.clientId,
    })

    // Assert — reuse is detected and rejected...
    await expect(replay).rejects.toMatchObject({ code: 'invalid_grant' })

    // ...and the WHOLE family is now revoked: even the currently-valid `second`
    // refresh token no longer works.
    const useSecond = h.tokens.token({
      grantType: 'refresh_token',
      refreshToken: second.refresh_token,
      clientId: h.clientId,
    })
    await expect(useSecond).rejects.toMatchObject({ code: 'invalid_grant' })

    // ...and every access token minted for the user in that family is revoked.
    const anyLive = await h.db.read(async (tx) => {
      const a = await tx.oauthAccessTokens.findByHash(
        createHash('sha256').update(second.access_token).digest('hex'),
      )
      return a?.revokedAt ?? null
    })
    expect(anyLive).not.toBeNull()
  })

  it('rejects a refresh token issued to a different client', async () => {
    // Arrange
    const h = await harness()
    const refresh = await issueRefresh(h)

    // Act
    const act = h.tokens.token({
      grantType: 'refresh_token',
      refreshToken: refresh,
      clientId: 'some-other-client',
    })

    // Assert
    await expect(act).rejects.toMatchObject({ code: 'invalid_grant' })
  })

  it('rejects an unknown refresh token', async () => {
    // Arrange
    const h = await harness()

    // Act
    const act = h.tokens.token({
      grantType: 'refresh_token',
      refreshToken: 'rkr_nope',
      clientId: h.clientId,
    })

    // Assert
    await expect(act).rejects.toMatchObject({ code: 'invalid_grant' })
  })

  it('rejects an expired refresh token', async () => {
    // Arrange
    const h = await harness()
    const refresh = await issueRefresh(h)

    // Act — advance past the 45-day refresh TTL.
    for (let i = 0; i < 46; i += 1) h.clock.advanceDays(1)
    const act = h.tokens.token({
      grantType: 'refresh_token',
      refreshToken: refresh,
      clientId: h.clientId,
    })

    // Assert
    await expect(act).rejects.toMatchObject({ code: 'invalid_grant' })
  })
})
