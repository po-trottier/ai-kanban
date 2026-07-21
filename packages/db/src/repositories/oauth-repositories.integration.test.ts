import {
  type OAuthAccessToken,
  type OAuthAuthorizationCode,
  type OAuthClient,
  type OAuthRefreshToken,
  type TransactionContext,
} from '@rivian-kanban/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { insertUser, newId, openTestDb, seedBaseline, T0, type TestDb } from '../test/support.ts'

/**
 * Integration coverage for the OAuth persistence adapters (ADR-021 phase 1):
 * client + code + access/refresh token round-trips against a real SQLite db,
 * and the two atomicity contracts the token endpoint will depend on —
 * `consume` is single-use, and `markUsed` detects refresh-token reuse.
 */

let db: TestDb

beforeAll(() => {
  db = openTestDb()
  seedBaseline(db.connection)
})

afterAll(() => {
  db.cleanup()
})

function run<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
  return db.uow.run(fn)
}

/** Inserts a client and returns it — codes/tokens FK-reference it. */
async function makeClient(overrides: Partial<OAuthClient> = {}): Promise<OAuthClient> {
  const client: OAuthClient = {
    id: `client-${newId()}`,
    name: 'Codex',
    redirectUris: ['http://127.0.0.1:53000/callback'],
    createdAt: T0,
    ...overrides,
  }
  await run((tx) => tx.oauthClients.insert(client))
  return client
}

function makeCode(
  clientId: string,
  userId: string,
  overrides: Partial<OAuthAuthorizationCode> = {},
): OAuthAuthorizationCode {
  return {
    codeHash: `code-${newId()}`,
    clientId,
    userId,
    redirectUri: 'http://127.0.0.1:53000/callback',
    resource: 'http://localhost:3000/mcp',
    scope: 'read_write',
    codeChallenge: 'challenge-abc',
    codeChallengeMethod: 'S256',
    expiresAt: '2026-07-16T12:01:00.000Z',
    ...overrides,
  }
}

function makeAccessToken(
  clientId: string,
  userId: string,
  overrides: Partial<OAuthAccessToken> = {},
): OAuthAccessToken {
  return {
    id: newId(),
    tokenHash: `at-${newId()}`,
    userId,
    clientId,
    scope: 'read',
    resource: 'http://localhost:3000/mcp',
    expiresAt: '2026-07-16T13:00:00.000Z',
    revokedAt: null,
    lastUsedAt: null,
    createdAt: T0,
    ...overrides,
  }
}

function makeRefreshToken(
  clientId: string,
  userId: string,
  overrides: Partial<OAuthRefreshToken> = {},
): OAuthRefreshToken {
  return {
    id: newId(),
    tokenHash: `rt-${newId()}`,
    familyId: newId(),
    userId,
    clientId,
    scope: 'read_write',
    resource: 'http://localhost:3000/mcp',
    expiresAt: '2026-08-15T12:00:00.000Z',
    usedAt: null,
    revokedAt: null,
    createdAt: T0,
    ...overrides,
  }
}

describe('SqliteOAuthClientRepository', () => {
  it('inserts and finds a client by id, preserving the redirect-uri array', async () => {
    const client = await makeClient({
      redirectUris: ['http://127.0.0.1:1/cb', 'http://[::1]:1/cb'],
    })

    const found = await run((tx) => tx.oauthClients.findById(client.id))

    expect(found).toEqual(client)
    await expect(run((tx) => tx.oauthClients.findById('nope'))).resolves.toBeNull()
  })
})

describe('SqliteOAuthAuthorizationCodeRepository', () => {
  it('consume returns the code exactly once, then null (single-use)', async () => {
    const client = await makeClient()
    const user = insertUser(db.connection)
    const code = makeCode(client.id, user.id)
    await run((tx) => tx.oauthAuthorizationCodes.insert(code))

    // First redemption returns the full row…
    const first = await run((tx) => tx.oauthAuthorizationCodes.consume(code.codeHash))
    // …a second (replay) finds nothing — the row was deleted atomically.
    const second = await run((tx) => tx.oauthAuthorizationCodes.consume(code.codeHash))

    expect(first).toEqual(code)
    expect(second).toBeNull()
  })

  it('consume returns null for an unknown code hash', async () => {
    await expect(
      run((tx) => tx.oauthAuthorizationCodes.consume(`missing-${newId()}`)),
    ).resolves.toBeNull()
  })
})

describe('SqliteOAuthAccessTokenRepository', () => {
  it('inserts, finds by hash, stamps last-used, and revokes (still findable)', async () => {
    const client = await makeClient()
    const user = insertUser(db.connection)
    const token = makeAccessToken(client.id, user.id)
    await run((tx) => tx.oauthAccessTokens.insert(token))

    await expect(run((tx) => tx.oauthAccessTokens.findByHash(token.tokenHash))).resolves.toEqual(
      token,
    )

    await run((tx) => tx.oauthAccessTokens.updateLastUsed(token.id, '2026-07-16T12:30:00.000Z'))
    await run((tx) => tx.oauthAccessTokens.revoke(token.id))

    // findByHash still returns the row after revocation — the caller checks revokedAt.
    const after = await run((tx) => tx.oauthAccessTokens.findByHash(token.tokenHash))
    expect(after?.lastUsedAt).toBe('2026-07-16T12:30:00.000Z')
    expect(after?.revokedAt).not.toBeNull()
  })

  it('revokeForUser revokes only that user’s live tokens', async () => {
    const client = await makeClient()
    const user = insertUser(db.connection)
    const other = insertUser(db.connection)
    const mine = makeAccessToken(client.id, user.id)
    const theirs = makeAccessToken(client.id, other.id)
    await run((tx) => tx.oauthAccessTokens.insert(mine))
    await run((tx) => tx.oauthAccessTokens.insert(theirs))

    await run((tx) => tx.oauthAccessTokens.revokeForUser(user.id))

    const mineAfter = await run((tx) => tx.oauthAccessTokens.findByHash(mine.tokenHash))
    const theirsAfter = await run((tx) => tx.oauthAccessTokens.findByHash(theirs.tokenHash))
    expect(mineAfter?.revokedAt).not.toBeNull()
    expect(theirsAfter?.revokedAt).toBeNull()
  })
})

describe('SqliteOAuthRefreshTokenRepository', () => {
  it('markUsed returns true exactly once, then false (reuse detection)', async () => {
    const client = await makeClient()
    const user = insertUser(db.connection)
    const token = makeRefreshToken(client.id, user.id)
    await run((tx) => tx.oauthRefreshTokens.insert(token))

    // The first rotation claims the token…
    const first = await run((tx) => tx.oauthRefreshTokens.markUsed(token.id))
    // …a replay of the same (now spent) token is caught: false ⇒ reuse.
    const second = await run((tx) => tx.oauthRefreshTokens.markUsed(token.id))

    expect(first).toBe(true)
    expect(second).toBe(false)
    const after = await run((tx) => tx.oauthRefreshTokens.findByHash(token.tokenHash))
    expect(after?.usedAt).not.toBeNull()
  })

  it('markUsed returns false for an unknown id', async () => {
    await expect(run((tx) => tx.oauthRefreshTokens.markUsed(newId()))).resolves.toBe(false)
  })

  it('revokeFamily revokes every token in the rotation chain', async () => {
    const client = await makeClient()
    const user = insertUser(db.connection)
    const familyId = newId()
    const first = makeRefreshToken(client.id, user.id, { familyId })
    const rotated = makeRefreshToken(client.id, user.id, { familyId })
    const otherFamily = makeRefreshToken(client.id, user.id)
    await run((tx) => tx.oauthRefreshTokens.insert(first))
    await run((tx) => tx.oauthRefreshTokens.insert(rotated))
    await run((tx) => tx.oauthRefreshTokens.insert(otherFamily))

    await run((tx) => tx.oauthRefreshTokens.revokeFamily(familyId))

    expect(
      (await run((tx) => tx.oauthRefreshTokens.findByHash(first.tokenHash)))?.revokedAt,
    ).not.toBeNull()
    expect(
      (await run((tx) => tx.oauthRefreshTokens.findByHash(rotated.tokenHash)))?.revokedAt,
    ).not.toBeNull()
    // A token in a different family is untouched.
    expect(
      (await run((tx) => tx.oauthRefreshTokens.findByHash(otherFamily.tokenHash)))?.revokedAt,
    ).toBeNull()
  })

  it('revokeForUser revokes only that user’s refresh tokens', async () => {
    const client = await makeClient()
    const user = insertUser(db.connection)
    const other = insertUser(db.connection)
    const mine = makeRefreshToken(client.id, user.id)
    const theirs = makeRefreshToken(client.id, other.id)
    await run((tx) => tx.oauthRefreshTokens.insert(mine))
    await run((tx) => tx.oauthRefreshTokens.insert(theirs))

    await run((tx) => tx.oauthRefreshTokens.revokeForUser(user.id))

    expect(
      (await run((tx) => tx.oauthRefreshTokens.findByHash(mine.tokenHash)))?.revokedAt,
    ).not.toBeNull()
    expect(
      (await run((tx) => tx.oauthRefreshTokens.findByHash(theirs.tokenHash)))?.revokedAt,
    ).toBeNull()
  })
})
