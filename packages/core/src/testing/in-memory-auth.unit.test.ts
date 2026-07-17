import { describe, expect, it } from 'vitest'
import { ConflictError, NotFoundError } from '../domain/errors.ts'
import { type ServiceToken, type Session } from '../domain/entities.ts'
import { createScenario, fixtureId } from './scenario.ts'

/**
 * The in-memory fakes for the auth persistence ports (user accounts,
 * sessions, service tokens, location/tag admin) must behave like the real
 * adapters in packages/db — these tests pin the shared contract.
 */

function makeSession(userId: string, overrides: Partial<Session> = {}): Session {
  return {
    id: `hash-${fixtureId(900)}${Math.random().toString(16).slice(2)}`,
    userId,
    createdAt: '2026-07-16T12:00:00.000Z',
    expiresAt: '2026-07-23T12:00:00.000Z',
    lastSeenAt: '2026-07-16T12:00:00.000Z',
    ...overrides,
  }
}

function makeToken(createdBy: string, overrides: Partial<ServiceToken> = {}): ServiceToken {
  return {
    id: fixtureId(700),
    name: 'agent',
    tokenHash: 'sha-1',
    role: 'technician',
    scope: 'read',
    createdBy,
    createdAt: '2026-07-16T12:00:00.000Z',
    lastUsedAt: null,
    revokedAt: null,
    ...overrides,
  }
}

describe('InMemoryUserAccountRepository', () => {
  it('finds by email case-insensitively with the seeded hash beside the entity', async () => {
    // Arrange
    const scenario = createScenario()

    // Act
    const credentials = await scenario.db.run((tx) =>
      tx.userAccounts.findByEmail('ADMIN@example.com'),
    )

    // Assert
    expect(credentials?.user.id).toBe(scenario.users.admin.id)
    expect(credentials?.passwordHash).toBeTruthy()
  })

  it('finds by stored Slack binding exactly; unbound ids resolve null', async () => {
    // Arrange
    const scenario = createScenario()
    const target = scenario.users.technician
    await scenario.db.run((tx) => tx.userAccounts.update({ ...target, slackUserId: 'U0TECH' }))

    // Act
    const bound = await scenario.db.run((tx) => tx.userAccounts.findBySlackUserId('U0TECH'))
    const unbound = await scenario.db.run((tx) => tx.userAccounts.findBySlackUserId('U0GHOST'))

    // Assert
    expect(bound?.user.id).toBe(target.id)
    expect(bound?.passwordHash).toBeTruthy()
    expect(unbound).toBeNull()
  })

  it('rejects inserting a duplicate email with ConflictError', async () => {
    // Arrange
    const scenario = createScenario()
    const clone = { ...scenario.users.admin, id: fixtureId(600) }

    // Act
    const act = scenario.db.run((tx) => tx.userAccounts.insert(clone, 'hash'))

    // Assert
    await expect(act).rejects.toBeInstanceOf(ConflictError)
  })

  it('updates profile fields and lists every user including inactive ones', async () => {
    // Arrange
    const scenario = createScenario()
    const target = scenario.users.requester

    // Act
    await scenario.db.run((tx) => tx.userAccounts.update({ ...target, isActive: false }))
    const listed = await scenario.db.run((tx) => tx.userAccounts.list())

    // Assert
    expect(listed.find((user) => user.id === target.id)?.isActive).toBe(false)
  })

  it('countHumanUsers excludes exactly the given automation user, any status', async () => {
    // Arrange
    const scenario = createScenario()
    const all = await scenario.db.run((tx) => tx.userAccounts.list())
    await scenario.db.run((tx) =>
      tx.userAccounts.update({ ...scenario.users.requester, isActive: false }),
    )

    // Act
    const count = await scenario.db.run((tx) =>
      tx.userAccounts.countHumanUsers(scenario.users.admin.id),
    )

    // Assert — the deactivated requester still counts; only the excluded id doesn't.
    expect(count).toBe(all.length - 1)
  })

  it('setPassword replaces the hash and flag; unknown users reject NotFound', async () => {
    // Arrange
    const scenario = createScenario()
    const target = scenario.users.technician

    // Act
    await scenario.db.run((tx) => tx.userAccounts.setPassword(target.id, 'new-hash', true))
    const after = await scenario.db.run((tx) => tx.userAccounts.findById(target.id))

    // Assert
    expect(after?.passwordHash).toBe('new-hash')
    expect(after?.user.mustChangePassword).toBe(true)
    await expect(
      scenario.db.run((tx) => tx.userAccounts.setPassword(fixtureId(601), 'h', false)),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      scenario.db.run((tx) =>
        tx.userAccounts.update({ ...scenario.users.admin, id: fixtureId(602) }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('InMemorySessionRepository', () => {
  it('creates, finds, and touches sessions', async () => {
    // Arrange
    const scenario = createScenario()
    const session = makeSession(scenario.users.admin.id)

    // Act
    await scenario.db.run((tx) => tx.sessions.create(session))
    await scenario.db.run((tx) =>
      tx.sessions.touch(session.id, '2026-07-17T12:00:00.000Z', '2026-07-24T12:00:00.000Z'),
    )
    const found = await scenario.db.run((tx) => tx.sessions.findByHash(session.id))

    // Assert
    expect(found?.lastSeenAt).toBe('2026-07-17T12:00:00.000Z')
    expect(found?.expiresAt).toBe('2026-07-24T12:00:00.000Z')
    await expect(scenario.db.run((tx) => tx.sessions.findByHash('nope'))).resolves.toBeNull()
  })

  it('revokeOthersForUser keeps only the excepted session; revoke deletes one', async () => {
    // Arrange
    const scenario = createScenario()
    const userId = scenario.users.admin.id
    const current = makeSession(userId, { id: 'hash-current' })
    const other = makeSession(userId, { id: 'hash-other' })
    const foreign = makeSession(scenario.users.requester.id, { id: 'hash-foreign' })
    scenario.db.seedSession(current)
    scenario.db.seedSession(other)
    scenario.db.seedSession(foreign)

    // Act
    await scenario.db.run((tx) => tx.sessions.revokeOthersForUser(userId, current.id))
    await scenario.db.run((tx) => tx.sessions.revoke(foreign.id))

    // Assert
    expect(scenario.db.sessionsFor(userId).map((session) => session.id)).toEqual(['hash-current'])
    expect(scenario.db.sessionsFor(foreign.userId)).toEqual([])
  })

  it('revokeOthersForUser without an exception and deleteExpired purge sessions', async () => {
    // Arrange
    const scenario = createScenario()
    const userId = scenario.users.supervisor.id
    scenario.db.seedSession(makeSession(userId, { id: 'hash-a' }))
    scenario.db.seedSession(makeSession(userId, { id: 'hash-b' }))
    scenario.db.seedSession(
      makeSession(scenario.users.requester.id, {
        id: 'hash-expired',
        expiresAt: '2026-07-01T00:00:00.000Z',
      }),
    )

    // Act
    await scenario.db.run((tx) => tx.sessions.revokeOthersForUser(userId))
    const purged = await scenario.db.run((tx) =>
      tx.sessions.deleteExpired('2026-07-16T00:00:00.000Z'),
    )

    // Assert
    expect(scenario.db.sessionsFor(userId)).toEqual([])
    expect(purged).toBe(1)
    expect(scenario.db.sessionsFor(scenario.users.requester.id)).toEqual([])
  })
})

describe('InMemoryServiceTokenRepository', () => {
  it('inserts, finds by hash, stamps last use, and lists newest first', async () => {
    // Arrange
    const scenario = createScenario()
    const admin = scenario.users.admin
    const older = makeToken(admin.id, {
      id: fixtureId(701),
      tokenHash: 'sha-old',
      createdAt: '2026-07-01T00:00:00.000Z',
    })
    const newer = makeToken(admin.id, {
      id: fixtureId(702),
      tokenHash: 'sha-new',
      createdAt: '2026-07-15T00:00:00.000Z',
    })

    // Act
    await scenario.db.run((tx) => tx.serviceTokens.insert(older))
    await scenario.db.run((tx) => tx.serviceTokens.insert(newer))
    await scenario.db.run((tx) =>
      tx.serviceTokens.updateLastUsed(older.id, '2026-07-16T13:00:00.000Z'),
    )
    const listed = await scenario.db.run((tx) => tx.serviceTokens.list())
    const found = await scenario.db.run((tx) => tx.serviceTokens.findByHash('sha-old'))

    // Assert
    expect(listed.map((token) => token.id)).toEqual([newer.id, older.id])
    expect(found?.lastUsedAt).toBe('2026-07-16T13:00:00.000Z')
  })

  it('revoke is idempotent and unknown ids reject NotFound', async () => {
    // Arrange
    const scenario = createScenario()
    const token = makeToken(scenario.users.admin.id, { id: fixtureId(703) })
    await scenario.db.run((tx) => tx.serviceTokens.insert(token))

    // Act
    await scenario.db.run((tx) => tx.serviceTokens.revoke(token.id, '2026-07-16T14:00:00.000Z'))
    await scenario.db.run((tx) => tx.serviceTokens.revoke(token.id, '2026-07-17T14:00:00.000Z'))

    // Assert
    expect(scenario.db.getServiceToken(token.id).revokedAt).toBe('2026-07-16T14:00:00.000Z')
    await expect(
      scenario.db.run((tx) => tx.serviceTokens.revoke(fixtureId(704), 'x')),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      scenario.db.run((tx) => tx.serviceTokens.updateLastUsed(fixtureId(705), 'x')),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(scenario.db.run((tx) => tx.serviceTokens.findByHash('gone'))).resolves.toBeNull()
  })
})

describe('InMemoryLocationRepository admin surface', () => {
  it('lists, inserts, updates, and deletes locations', async () => {
    // Arrange
    const scenario = createScenario()
    const annex = { id: fixtureId(801), parentId: null, kind: 'building' as const, name: 'Annex' }

    // Act
    await scenario.db.run((tx) => tx.locations.insert(annex))
    await scenario.db.run((tx) => tx.locations.update({ ...annex, name: 'Renamed' }))
    const listed = await scenario.db.run((tx) => tx.locations.list())
    await scenario.db.run((tx) => tx.locations.delete(annex.id))

    // Assert
    expect(listed.find((location) => location.id === annex.id)?.name).toBe('Renamed')
    await expect(scenario.db.run((tx) => tx.locations.findById(annex.id))).resolves.toBeNull()
  })

  it('recursively deletes a subtree and clears referencing cards; 404s unknown ids', async () => {
    // BUG 2: deleting a building removes its floor/room too, and any card that
    // referenced a removed node keeps its row with location cleared.
    // Arrange
    const scenario = createScenario()
    const building = { id: fixtureId(802), parentId: null, kind: 'building' as const, name: 'B' }
    const floor = { id: fixtureId(803), parentId: building.id, kind: 'floor' as const, name: '1' }
    const room = { id: fixtureId(808), parentId: floor.id, kind: 'room' as const, name: '101' }
    scenario.db.seedLocation(building)
    scenario.db.seedLocation(floor)
    scenario.db.seedLocation(room)
    const located = scenario.seedCard({ locationId: room.id })

    // Act
    await scenario.db.run((tx) => tx.locations.delete(building.id))
    const deleteGhost = scenario.db.run((tx) => tx.locations.delete(fixtureId(804)))
    const updateGhost = scenario.db.run((tx) =>
      tx.locations.update({ id: fixtureId(805), parentId: null, kind: 'room', name: 'ghost' }),
    )

    // Assert
    const remaining = await scenario.db.run((tx) => tx.locations.list())
    expect(remaining).toEqual([])
    // The card survives with its optional location cleared.
    expect(scenario.db.getCard(located.id).locationId).toBeNull()
    await expect(deleteGhost).rejects.toBeInstanceOf(NotFoundError)
    await expect(updateGhost).rejects.toBeInstanceOf(NotFoundError)
  })

  it('deletes a leaf without touching its ancestors', async () => {
    // Arrange
    const scenario = createScenario()
    const building = { id: fixtureId(809), parentId: null, kind: 'building' as const, name: 'B2' }
    const floor = { id: fixtureId(810), parentId: building.id, kind: 'floor' as const, name: '2' }
    const room = { id: fixtureId(811), parentId: floor.id, kind: 'room' as const, name: '201' }
    scenario.db.seedLocation(building)
    scenario.db.seedLocation(floor)
    scenario.db.seedLocation(room)

    // Act
    await scenario.db.run((tx) => tx.locations.delete(room.id))

    // Assert
    const remaining = await scenario.db.run((tx) => tx.locations.list())
    expect(remaining.map((location) => location.id).sort()).toEqual([building.id, floor.id].sort())
  })
})

describe('InMemoryTagRepository.listAll', () => {
  it('returns every known tag in name order', async () => {
    // Arrange
    const scenario = createScenario()
    scenario.db.seedTag({ id: fixtureId(806), name: 'zebra' })
    scenario.db.seedTag({ id: fixtureId(807), name: 'alpha' })

    // Act
    const listed = await scenario.db.run((tx) => tx.tags.listAll())

    // Assert
    expect(listed.map((tag) => tag.name)).toEqual(['alpha', 'zebra'])
  })
})
