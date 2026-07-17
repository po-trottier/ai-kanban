import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import { NotFoundError, PolicyDeniedError } from '../domain/errors.ts'
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

  it('denies non-admins (admin-only is always-on)', async () => {
    // Arrange
    const scenario = createScenario()

    // Act
    const act = scenario.policies.apply(scenario.actors.supervisor, DEFAULT_POLICY_DOCUMENT)

    // Assert
    await expect(act).rejects.toBeInstanceOf(PolicyDeniedError)
    await expect(act).rejects.toMatchObject({ rule: 'admin-only' })
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
    // Arrange
    const scenario = createScenario()
    const invalid = { transitionEnforcement: true, transitions: [], actionGates: { cancel: 'god' } }

    // Act
    const act = scenario.policies.apply(scenario.actors.admin, invalid)

    // Assert
    await expect(act).rejects.toBeInstanceOf(ZodError)
    expect(scenario.db.policyVersionCount()).toBe(1)
  })
})
