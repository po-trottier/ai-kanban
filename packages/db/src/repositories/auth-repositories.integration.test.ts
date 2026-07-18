import {
  ConflictError,
  NotFoundError,
  type Session,
  type ServiceToken,
  type TransactionContext,
} from '@rivian-kanban/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  insertUser,
  makeCard,
  newId,
  openTestDb,
  seedBaseline,
  T0,
  type Baseline,
  type TestDb,
} from '../test/support.ts'

/**
 * Integration coverage for the auth persistence adapters consumed by the
 * server package: user accounts (login/admin CRUD), sessions (ADR-009), and
 * service tokens — plus the location/tag admin surfaces added with them.
 */

let db: TestDb
let base: Baseline

beforeAll(() => {
  db = openTestDb()
  base = seedBaseline(db.connection)
})

afterAll(() => {
  db.cleanup()
})

function run<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
  return db.uow.run(fn)
}

function makeSession(userId: string, overrides: Partial<Session> = {}): Session {
  return {
    id: `hash-${newId()}`,
    userId,
    createdAt: T0,
    expiresAt: '2026-07-23T12:00:00.000Z',
    lastSeenAt: T0,
    ...overrides,
  }
}

describe('SqliteUserAccountRepository', () => {
  it('finds by email case-insensitively and returns the hash beside the entity', async () => {
    const user = insertUser(db.connection, { email: 'casey@example.com' })

    const credentials = await run((tx) => tx.userAccounts.findByEmail('CASEY@Example.COM'))

    expect(credentials?.user).toEqual(user)
    expect(credentials?.passwordHash).toBeTruthy()
    expect(credentials === null || 'passwordHash' in credentials.user).toBe(false)
  })

  it('returns null for an unknown email and id', async () => {
    await expect(run((tx) => tx.userAccounts.findByEmail('nobody@example.com'))).resolves.toBeNull()
    await expect(run((tx) => tx.userAccounts.findById(newId()))).resolves.toBeNull()
  })

  it('finds by the stored Slack binding exactly; unbound ids resolve null', async () => {
    const user = insertUser(db.connection, { slackUserId: 'U0SLACK1' })

    const bound = await run((tx) => tx.userAccounts.findBySlackUserId('U0SLACK1'))

    expect(bound?.user).toEqual(user)
    expect(bound?.passwordHash).toBeTruthy()
    // Exact match only — Slack ids are opaque case-sensitive tokens.
    await expect(run((tx) => tx.userAccounts.findBySlackUserId('u0slack1'))).resolves.toBeNull()
    await expect(run((tx) => tx.userAccounts.findBySlackUserId('U0GHOST'))).resolves.toBeNull()
  })

  it('inserts with a hash and rejects a duplicate email with ConflictError', async () => {
    const user = insertUser(db.connection, { email: 'unique@example.com' })

    const clash = { ...user, id: newId(), email: 'UNIQUE@example.com' }
    // Same-cased duplicates conflict…
    await expect(
      run((tx) => tx.userAccounts.insert({ ...clash, email: user.email }, 'h')),
    ).rejects.toBeInstanceOf(ConflictError)
    // …and so do differently-cased ones: the lower(email) unique index makes
    // the DATABASE enforce the case-insensitive uniqueness every email
    // lookup (login, Slack identity) already assumes.
    await expect(run((tx) => tx.userAccounts.insert(clash, 'h'))).rejects.toBeInstanceOf(
      ConflictError,
    )
  })

  it('updates profile fields without touching the stored hash', async () => {
    const user = insertUser(db.connection)

    await run((tx) => tx.userAccounts.update({ ...user, displayName: 'Renamed', role: 'admin' }))

    const after = await run((tx) => tx.userAccounts.findById(user.id))
    expect(after?.user.displayName).toBe('Renamed')
    expect(after?.user.role).toBe('admin')
    expect(after?.passwordHash).toBeTruthy()
  })

  it('setPassword replaces the hash and the mustChangePassword flag atomically', async () => {
    const user = insertUser(db.connection)

    await run((tx) => tx.userAccounts.setPassword(user.id, 'new-hash', true))

    const after = await run((tx) => tx.userAccounts.findById(user.id))
    expect(after?.passwordHash).toBe('new-hash')
    expect(after?.user.mustChangePassword).toBe(true)
  })

  it('update and setPassword reject unknown users with NotFoundError', async () => {
    const ghost = { ...insertUser(db.connection), id: newId() }

    await expect(run((tx) => tx.userAccounts.update(ghost))).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      run((tx) => tx.userAccounts.setPassword(newId(), 'h', false)),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('list returns every user including inactive ones', async () => {
    const inactive = insertUser(db.connection, { isActive: false })

    const listed = await run((tx) => tx.userAccounts.list())

    expect(listed.map((user) => user.id)).toContain(inactive.id)
  })

  it('countHumanUsers excludes exactly the system user and counts any status', async () => {
    const before = await run((tx) => tx.userAccounts.countHumanUsers(base.systemUserId))
    insertUser(db.connection)
    insertUser(db.connection, { isActive: false })

    const after = await run((tx) => tx.userAccounts.countHumanUsers(base.systemUserId))
    const all = await run((tx) => tx.userAccounts.list())

    // Deactivated rows still count (first-boot setup can never reopen)…
    expect(after).toBe(before + 2)
    // …and the seeded automation user is the only exclusion.
    expect(after).toBe(all.length - 1)
  })
})

describe('SqliteSessionRepository', () => {
  it('creates and finds a session by hash', async () => {
    const user = insertUser(db.connection)
    const session = makeSession(user.id)

    await run((tx) => tx.sessions.create(session))

    await expect(run((tx) => tx.sessions.findByHash(session.id))).resolves.toEqual(session)
    await expect(run((tx) => tx.sessions.findByHash('missing'))).resolves.toBeNull()
  })

  it('touch slides lastSeenAt and expiresAt', async () => {
    const user = insertUser(db.connection)
    const session = makeSession(user.id)
    await run((tx) => tx.sessions.create(session))

    await run((tx) =>
      tx.sessions.touch(session.id, '2026-07-17T12:00:00.000Z', '2026-07-24T12:00:00.000Z'),
    )

    const after = await run((tx) => tx.sessions.findByHash(session.id))
    expect(after?.lastSeenAt).toBe('2026-07-17T12:00:00.000Z')
    expect(after?.expiresAt).toBe('2026-07-24T12:00:00.000Z')
  })

  it('revoke deletes exactly one session', async () => {
    const user = insertUser(db.connection)
    const kept = makeSession(user.id)
    const revoked = makeSession(user.id)
    await run((tx) => tx.sessions.create(kept))
    await run((tx) => tx.sessions.create(revoked))

    await run((tx) => tx.sessions.revoke(revoked.id))

    await expect(run((tx) => tx.sessions.findByHash(revoked.id))).resolves.toBeNull()
    await expect(run((tx) => tx.sessions.findByHash(kept.id))).resolves.toEqual(kept)
  })

  it('revokeOthersForUser keeps only the excepted session', async () => {
    const user = insertUser(db.connection)
    const current = makeSession(user.id)
    const other = makeSession(user.id)
    const foreign = makeSession(insertUser(db.connection).id)
    await run((tx) => tx.sessions.create(current))
    await run((tx) => tx.sessions.create(other))
    await run((tx) => tx.sessions.create(foreign))

    await run((tx) => tx.sessions.revokeOthersForUser(user.id, current.id))

    await expect(run((tx) => tx.sessions.findByHash(current.id))).resolves.toEqual(current)
    await expect(run((tx) => tx.sessions.findByHash(other.id))).resolves.toBeNull()
    await expect(run((tx) => tx.sessions.findByHash(foreign.id))).resolves.toEqual(foreign)
  })

  it('revokeOthersForUser without an exception revokes every session of the user', async () => {
    const user = insertUser(db.connection)
    const a = makeSession(user.id)
    const b = makeSession(user.id)
    await run((tx) => tx.sessions.create(a))
    await run((tx) => tx.sessions.create(b))

    await run((tx) => tx.sessions.revokeOthersForUser(user.id))

    await expect(run((tx) => tx.sessions.findByHash(a.id))).resolves.toBeNull()
    await expect(run((tx) => tx.sessions.findByHash(b.id))).resolves.toBeNull()
  })

  it('deleteExpired purges sessions at or past expiresAt and reports the count', async () => {
    const user = insertUser(db.connection)
    const expired = makeSession(user.id, { expiresAt: '2026-07-10T00:00:00.000Z' })
    const live = makeSession(user.id, { expiresAt: '2026-08-01T00:00:00.000Z' })
    await run((tx) => tx.sessions.create(expired))
    await run((tx) => tx.sessions.create(live))

    const purged = await run((tx) => tx.sessions.deleteExpired('2026-07-16T00:00:00.000Z'))

    expect(purged).toBeGreaterThanOrEqual(1)
    await expect(run((tx) => tx.sessions.findByHash(expired.id))).resolves.toBeNull()
    await expect(run((tx) => tx.sessions.findByHash(live.id))).resolves.toEqual(live)
  })
})

describe('SqliteServiceTokenRepository', () => {
  function makeToken(createdBy: string, overrides: Partial<ServiceToken> = {}): ServiceToken {
    return {
      id: newId(),
      name: 'ci-agent',
      tokenHash: `sha-${newId()}`,
      role: 'user',
      scope: 'read',
      createdBy,
      createdAt: T0,
      lastUsedAt: null,
      revokedAt: null,
      ...overrides,
    }
  }

  it('inserts, lists newest-first, and finds by hash', async () => {
    const admin = insertUser(db.connection, { role: 'admin' })
    const older = makeToken(admin.id, { createdAt: '2026-07-01T00:00:00.000Z' })
    const newer = makeToken(admin.id, { createdAt: '2026-07-15T00:00:00.000Z' })
    await run((tx) => tx.serviceTokens.insert(older))
    await run((tx) => tx.serviceTokens.insert(newer))

    const listed = await run((tx) => tx.serviceTokens.list())
    const ids = listed.map((token) => token.id)

    expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id))
    await expect(run((tx) => tx.serviceTokens.findByHash(older.tokenHash))).resolves.toEqual(older)
  })

  it('updateLastUsed stamps the row and rejects unknown ids', async () => {
    const admin = insertUser(db.connection, { role: 'admin' })
    const token = makeToken(admin.id)
    await run((tx) => tx.serviceTokens.insert(token))

    await run((tx) => tx.serviceTokens.updateLastUsed(token.id, '2026-07-16T13:00:00.000Z'))

    const after = await run((tx) => tx.serviceTokens.findByHash(token.tokenHash))
    expect(after?.lastUsedAt).toBe('2026-07-16T13:00:00.000Z')
    await expect(run((tx) => tx.serviceTokens.updateLastUsed(newId(), T0))).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })

  it('revoke sets revokedAt once and keeps the original timestamp on re-revoke', async () => {
    const admin = insertUser(db.connection, { role: 'admin' })
    const token = makeToken(admin.id)
    await run((tx) => tx.serviceTokens.insert(token))

    await run((tx) => tx.serviceTokens.revoke(token.id, '2026-07-16T14:00:00.000Z'))
    await run((tx) => tx.serviceTokens.revoke(token.id, '2026-07-17T14:00:00.000Z'))

    const after = await run((tx) => tx.serviceTokens.findByHash(token.tokenHash))
    expect(after?.revokedAt).toBe('2026-07-16T14:00:00.000Z')
    await expect(run((tx) => tx.serviceTokens.revoke(newId(), T0))).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })
})

describe('SqliteLocationRepository admin surface', () => {
  it('lists, inserts, updates, and deletes locations', async () => {
    const room = {
      id: newId(),
      parentId: null,
      kind: 'building' as const,
      name: 'Test Annex',
    }

    await run((tx) => tx.locations.insert(room))
    await run((tx) => tx.locations.update({ ...room, name: 'Renamed Annex' }))

    const listed = await run((tx) => tx.locations.list())
    expect(listed.find((location) => location.id === room.id)?.name).toBe('Renamed Annex')

    await run((tx) => tx.locations.delete(room.id))
    await expect(run((tx) => tx.locations.findById(room.id))).resolves.toBeNull()
  })

  it('recursively deletes a subtree and clears cards that referenced any removed node', async () => {
    // BUG 2: deleting a building takes its floor with it in one transaction,
    // and a card that referenced the floor keeps its row with location cleared.
    const building = { id: newId(), parentId: null, kind: 'building' as const, name: 'B-Wing' }
    const floor = { id: newId(), parentId: building.id, kind: 'floor' as const, name: 'F-1' }
    await run((tx) => tx.locations.insert(building))
    await run((tx) => tx.locations.insert(floor))

    const reporter = insertUser(db.connection)
    const card = makeCard({
      boardId: base.boardId,
      laneId: base.lanes.intake.id,
      reporterId: reporter.id,
      locationId: floor.id,
      position: `loc-${newId()}`,
    })
    await run((tx) => tx.cards.insert(card))

    await run((tx) => tx.locations.delete(building.id))

    // Both locations gone; the card survives with its location cleared.
    expect(await run((tx) => tx.locations.findById(building.id))).toBeNull()
    expect(await run((tx) => tx.locations.findById(floor.id))).toBeNull()
    expect(await run((tx) => tx.cards.findById(card.id))).toMatchObject({
      id: card.id,
      locationId: null,
    })
  })

  it('update and delete reject unknown locations with NotFoundError', async () => {
    await expect(
      run((tx) =>
        tx.locations.update({ id: newId(), parentId: null, kind: 'room', name: 'ghost' }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(run((tx) => tx.locations.delete(newId()))).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('SqliteTagRepository.listAll', () => {
  it('returns every known tag in name order', async () => {
    await run((tx) => tx.tags.insert({ id: newId(), name: 'zzz-last' }))
    await run((tx) => tx.tags.insert({ id: newId(), name: 'aaa-first' }))

    const listed = await run((tx) => tx.tags.listAll())
    const names = listed.map((tag) => tag.name)

    expect(names.indexOf('aaa-first')).toBeLessThan(names.indexOf('zzz-last'))
  })
})
