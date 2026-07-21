import {
  type OAuthAccessToken,
  type OAuthClient,
  type ServiceToken,
  type User,
} from '@rivian-kanban/core'
import { FixedClock, InMemoryDb, userWith } from '@rivian-kanban/core/testing'
import { describe, expect, it } from 'vitest'
import { BearerAuthRequiredError } from '../errors.ts'
import { canonicalMcpUri } from '../oauth/canonical-uri.ts'
import { ACCESS_TOKEN_PREFIX, sha256hex } from '../oauth/oauth-hash.ts'
import { DEFAULT_OAUTH_TTLS } from '../oauth/oauth-config.ts'
import { hashServiceToken } from '../tokens/token-hash.ts'
import { authenticateBearer } from './mcp-auth.ts'

/** The exact deps shape `authenticateBearer` consumes (uow, clock, config). */
type BearerDeps = Parameters<typeof authenticateBearer>[0]

/**
 * The /mcp Resource Server bearer gate (ADR-021 §A) over the in-memory ports:
 * an `rka_` access token resolves to an `agent` Actor bound to the user (its
 * role + the client name); the RFC 8707 audience check, expiry, and revocation
 * all 401 uniformly; an `rkb_` service token still resolves to the unchanged
 * `mcp` Actor. Every rejection carries the RFC 9728 discovery issuer.
 */

const ORIGIN = 'http://localhost:3000'
const CANONICAL_MCP = canonicalMcpUri(ORIGIN)
const NOW = '2026-07-20T12:00:00.000Z'

const USER_ID = '00000000-0000-7000-8000-0000000000aa'
const CLIENT_ID = 'client-codex'
const ACCESS_RAW = `${ACCESS_TOKEN_PREFIX}secret-access-value`

interface Harness {
  db: InMemoryDb
  deps: BearerDeps
}

function makeOauth() {
  return { issuer: ORIGIN, canonicalMcpUri: CANONICAL_MCP, ...DEFAULT_OAUTH_TTLS }
}

function harness(): Harness {
  const db = new InMemoryDb()
  const clock = new FixedClock(NOW)
  // The gate reads only uow/clock/config.oauth; the rest of AppConfig is unused
  // here, so this narrow stub is cast to the full deps type it never touches.
  const deps = { uow: db, clock, config: { oauth: makeOauth() } } as unknown as BearerDeps
  return { db, deps }
}

function seededUser(overrides: Partial<User> = {}): User {
  return userWith({
    id: USER_ID,
    email: 'operator@test.example',
    displayName: 'P-O',
    role: 'user',
    createdAt: NOW,
    ...overrides,
  })
}

async function seedClient(db: InMemoryDb, name = 'Codex'): Promise<void> {
  const client: OAuthClient = {
    id: CLIENT_ID,
    name,
    redirectUris: ['http://127.0.0.1:1455/callback'],
    createdAt: NOW,
  }
  await db.run((tx) => tx.oauthClients.insert(client))
}

/** Inserts an access token for the seeded user; every field overridable. */
async function seedAccessToken(
  db: InMemoryDb,
  overrides: Partial<OAuthAccessToken> = {},
): Promise<void> {
  const token: OAuthAccessToken = {
    id: '00000000-0000-7000-8000-0000000000a1',
    tokenHash: sha256hex(ACCESS_RAW),
    userId: USER_ID,
    clientId: CLIENT_ID,
    scope: 'read_write',
    resource: CANONICAL_MCP,
    expiresAt: '2026-07-20T13:00:00.000Z',
    revokedAt: null,
    lastUsedAt: null,
    createdAt: NOW,
    ...overrides,
  }
  await db.run((tx) => tx.oauthAccessTokens.insert(token))
}

function seedServiceToken(db: InMemoryDb, raw: string): ServiceToken {
  const token: ServiceToken = {
    id: '00000000-0000-7000-8000-0000000000b1',
    name: 'slack bot',
    tokenHash: hashServiceToken(raw),
    role: 'admin',
    scope: 'read',
    createdBy: USER_ID,
    createdAt: NOW,
    lastUsedAt: null,
    revokedAt: null,
  }
  db.seedServiceToken(token)
  return token
}

/** Resolves to the thrown error (fails loudly if the promise unexpectedly resolves). */
async function caught(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => expect.fail('expected a BearerAuthRequiredError 401'),
    (error: unknown) => error,
  )
}

describe('authenticateBearer — OAuth access token (agent)', () => {
  it("resolves an rka_ access token to an agent Actor with the user's role + client name", async () => {
    // Arrange — an admin operator authorized the "Codex" client for read+write.
    const { db, deps } = harness()
    db.seedUser(seededUser({ role: 'admin' }))
    await seedClient(db, 'Codex')
    await seedAccessToken(db)
    // Act
    const actor = await authenticateBearer(deps, `Bearer ${ACCESS_RAW}`)
    // Assert — the agent acts AS the user (its id/role ARE the user's), labelled.
    expect(actor).toEqual({
      kind: 'agent',
      id: USER_ID,
      role: 'admin',
      scope: 'read_write',
      client: { id: CLIENT_ID, name: 'Codex' },
    })
  })

  it('falls back to the client id as the label when the client row is gone', async () => {
    // Arrange — a token whose client registration no longer resolves.
    const { db, deps } = harness()
    db.seedUser(seededUser())
    await seedAccessToken(db)
    // Act
    const actor = await authenticateBearer(deps, `Bearer ${ACCESS_RAW}`)
    // Assert
    expect(actor.kind).toBe('agent')
    expect(actor.client).toEqual({ id: CLIENT_ID, name: CLIENT_ID })
  })

  it('401s a token whose resource ≠ the canonical /mcp URI (RFC 8707 audience)', async () => {
    // Arrange — a valid token minted for a DIFFERENT audience.
    const { db, deps } = harness()
    db.seedUser(seededUser())
    await seedClient(db)
    await seedAccessToken(db, { resource: 'http://localhost:3000/other' })
    // Act
    const error = await caught(authenticateBearer(deps, `Bearer ${ACCESS_RAW}`))
    // Assert
    expect(error).toBeInstanceOf(BearerAuthRequiredError)
  })

  it('401s a revoked access token', async () => {
    // Arrange
    const { db, deps } = harness()
    db.seedUser(seededUser())
    await seedClient(db)
    await seedAccessToken(db, { revokedAt: '2026-07-20T11:00:00.000Z' })
    // Act
    const error = await caught(authenticateBearer(deps, `Bearer ${ACCESS_RAW}`))
    // Assert
    expect(error).toBeInstanceOf(BearerAuthRequiredError)
  })

  it('401s an expired access token', async () => {
    // Arrange — expiresAt is before the fixed clock's now.
    const { db, deps } = harness()
    db.seedUser(seededUser())
    await seedClient(db)
    await seedAccessToken(db, { expiresAt: '2026-07-20T11:59:59.000Z' })
    // Act
    const error = await caught(authenticateBearer(deps, `Bearer ${ACCESS_RAW}`))
    // Assert
    expect(error).toBeInstanceOf(BearerAuthRequiredError)
  })

  it('401s when the operator is deactivated (agent ≤ operator)', async () => {
    // Arrange
    const { db, deps } = harness()
    db.seedUser(seededUser({ isActive: false }))
    await seedClient(db)
    await seedAccessToken(db)
    // Act
    const error = await caught(authenticateBearer(deps, `Bearer ${ACCESS_RAW}`))
    // Assert
    expect(error).toBeInstanceOf(BearerAuthRequiredError)
  })

  it('401s an unknown access token', async () => {
    // Arrange — nothing seeded.
    const { deps } = harness()
    // Act
    const error = await caught(
      authenticateBearer(deps, `Bearer ${ACCESS_TOKEN_PREFIX}never-minted`),
    )
    // Assert
    expect(error).toBeInstanceOf(BearerAuthRequiredError)
  })

  it('throttles updateLastUsed like the service-token path', async () => {
    // Arrange
    const { db, deps } = harness()
    db.seedUser(seededUser())
    await seedClient(db)
    await seedAccessToken(db)
    // Act
    await authenticateBearer(deps, `Bearer ${ACCESS_RAW}`)
    // Assert — first use stamps lastUsedAt at the fixed clock's now.
    const used = await db.read((tx) => tx.oauthAccessTokens.findByHash(sha256hex(ACCESS_RAW)))
    expect(used?.lastUsedAt).toBe(NOW)
  })
})

describe('authenticateBearer — service token (mcp), unchanged', () => {
  it('resolves an rkb_ service token to the mcp Actor with its own role', async () => {
    // Arrange
    const { db, deps } = harness()
    const raw = 'rkb_service-secret'
    const token = seedServiceToken(db, raw)
    // Act
    const actor = await authenticateBearer(deps, `Bearer ${raw}`)
    // Assert — the ADR-021 §F headless path is unchanged (kind mcp, token role).
    expect(actor).toEqual({ kind: 'mcp', id: token.id, role: 'admin', scope: 'read' })
  })

  it('401s a revoked service token', async () => {
    // Arrange
    const { db, deps } = harness()
    const raw = 'rkb_revoked-secret'
    const token = seedServiceToken(db, raw)
    await db.run((tx) => tx.serviceTokens.revoke(token.id, NOW))
    // Act
    const error = await caught(authenticateBearer(deps, `Bearer ${raw}`))
    // Assert
    expect(error).toBeInstanceOf(BearerAuthRequiredError)
  })
})

describe('authenticateBearer — challenge metadata', () => {
  it('carries the RFC 9728 issuer on a missing credential (tokenPresented=false)', async () => {
    // Arrange
    const { deps } = harness()
    // Act
    const error = await authenticateBearer(deps, undefined).catch((e: unknown) => e)
    // Assert — a bare challenge (no credential) still advertises discovery.
    expect(error).toBeInstanceOf(BearerAuthRequiredError)
    expect((error as BearerAuthRequiredError).tokenPresented).toBe(false)
    expect((error as BearerAuthRequiredError).resourceMetadataIssuer).toBe(ORIGIN)
  })

  it('carries the issuer and marks tokenPresented on a rejected credential', async () => {
    // Arrange
    const { deps } = harness()
    // Act
    const error = await authenticateBearer(deps, 'Bearer rkb_bogus').catch((e: unknown) => e)
    // Assert
    expect((error as BearerAuthRequiredError).tokenPresented).toBe(true)
    expect((error as BearerAuthRequiredError).resourceMetadataIssuer).toBe(ORIGIN)
  })
})
