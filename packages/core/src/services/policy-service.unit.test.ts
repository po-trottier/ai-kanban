import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import { ConflictError, NotFoundError, PolicyDeniedError } from '../domain/errors.ts'
import { DEFAULT_POLICY_DOCUMENT } from '../domain/policy.ts'
import { createScenario } from '../testing/index.ts'

describe('PolicyService.getActive', () => {
  it('returns the seeded active policy version', async () => {
    // Arrange
    const scenario = createScenario()

    // Act
    const record = await scenario.policies.getActive()

    // Assert
    expect(record.boardId).toBe(scenario.boardId)
    expect(record.config).toEqual(DEFAULT_POLICY_DOCUMENT)
  })

  it('fails when no policy version exists', async () => {
    // Arrange
    const scenario = createScenario({ omitPolicyRecord: true })

    // Act
    const act = scenario.policies.getActive()

    // Assert
    await expect(act).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('PolicyService.apply', () => {
  it('appends a new admin-authored version and hints policy.updated', async () => {
    // Arrange
    const scenario = createScenario()
    const nextDocument = { ...DEFAULT_POLICY_DOCUMENT, transitionEnforcement: true }

    // Act
    const record = await scenario.policies.apply(scenario.actors.admin, nextDocument)

    // Assert
    expect(record.config.transitionEnforcement).toBe(true)
    expect(record.createdBy).toBe(scenario.actors.admin.id)
    expect(scenario.db.policyVersionCount()).toBe(2)
    expect(scenario.eventBus.published).toEqual([{ type: 'policy.updated' }])
  })

  it('becomes the active policy that services consult', async () => {
    // Arrange
    const scenario = createScenario()
    await scenario.policies.apply(scenario.actors.admin, {
      ...DEFAULT_POLICY_DOCUMENT,
      transitionEnforcement: true,
    })
    const card = scenario.seedCard({ laneId: scenario.lanes.intake.id })

    // Act — intake→ready has no edge in the enforced graph
    const act = scenario.cards.move(scenario.actors.admin, card.id, {
      toLane: 'ready',
      expectedVersion: 1,
    })

    // Assert
    await expect(act).rejects.toMatchObject({ from: 'intake', to: 'ready' })
  })

  it('denies a role without managePolicy (default-deny)', async () => {
    // Arrange — the technician is a plain `user`, no managePolicy grant.
    const scenario = createScenario()

    // Act
    const act = scenario.policies.apply(scenario.actors.technician, DEFAULT_POLICY_DOCUMENT)

    // Assert
    await expect(act).rejects.toBeInstanceOf(PolicyDeniedError)
    await expect(act).rejects.toMatchObject({ rule: 'permission:managePolicy' })
    expect(scenario.db.policyVersionCount()).toBe(1)
  })

  it('rejects dropping a role key still assigned to an active user (role-in-use)', async () => {
    // Arrange — every seeded fixture user is `user` or `admin`; a document that
    // omits `user` orphans the requester/technician.
    const scenario = createScenario()
    const withoutUserRole = {
      ...DEFAULT_POLICY_DOCUMENT,
      roles: DEFAULT_POLICY_DOCUMENT.roles.filter((role) => role.key !== 'user'),
    }

    // Act
    const act = scenario.policies.apply(scenario.actors.admin, withoutUserRole)

    // Assert
    await expect(act).rejects.toBeInstanceOf(ConflictError)
    await expect(act).rejects.toThrow('role-in-use')
    expect(scenario.db.policyVersionCount()).toBe(1)
  })

  it('denies a read-scope token even with an admin role', async () => {
    // Arrange
    const scenario = createScenario()
    const readAdminToken = {
      kind: 'mcp',
      id: scenario.actors.mcpRead.id,
      role: 'admin',
      scope: 'read',
    } as const

    // Act
    const act = scenario.policies.apply(readAdminToken, DEFAULT_POLICY_DOCUMENT)

    // Assert
    await expect(act).rejects.toMatchObject({ rule: 'token-scope-read' })
  })

  it('rejects a document that fails the canonical schema', async () => {
    // Arrange — no roles array is a schema violation (roles are required now).
    const scenario = createScenario()
    const invalid = { transitionEnforcement: true, transitions: [] }

    // Act
    const act = scenario.policies.apply(scenario.actors.admin, invalid)

    // Assert
    await expect(act).rejects.toBeInstanceOf(ZodError)
    expect(scenario.db.policyVersionCount()).toBe(1)
  })
})
