import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import { NotFoundError, PolicyDeniedError } from '../domain/errors.ts'
import { createScenario, fixtureId } from '../testing/index.ts'

describe('CardService.create', () => {
  it('lands at the top of intake with the documented defaults', async () => {
    // Arrange
    const scenario = createScenario()
    const existing = scenario.seedCard({ laneId: scenario.lanes.intake.id })

    // Act
    const card = await scenario.cards.create(scenario.actors.requester, { title: 'Fix door' })

    // Assert
    expect(card.laneId).toBe(scenario.lanes.intake.id)
    expect(card.position < existing.position).toBe(true)
    expect(card.description).toBe('')
    expect(card.priority).toBe('P2')
    expect(card.origin).toBe('manual')
    expect(card.reporterId).toBe(scenario.actors.requester.id)
    expect(card.version).toBe(1)
  })

  it('writes a card.created audit event with a full snapshot including tags', async () => {
    // Arrange
    const scenario = createScenario()

    // Act
    const card = await scenario.cards.create(scenario.actors.technician, {
      title: 'Replace filter',
      tags: ['HVAC'],
    })

    // Assert
    const events = scenario.db.eventsFor(card.id)
    expect(events).toHaveLength(1)
    expect(events.at(0)).toMatchObject({
      eventType: 'card.created',
      actorKind: 'user',
      actorId: scenario.actors.technician.id,
      payload: { snapshot: { id: card.id, title: 'Replace filter', tags: ['HVAC'] } },
    })
  })

  it('publishes a card.created SSE hint after commit', async () => {
    // Arrange
    const scenario = createScenario()

    // Act
    const card = await scenario.cards.create(scenario.actors.requester, { title: 'Check pump' })

    // Assert
    expect(scenario.eventBus.published).toEqual([
      {
        type: 'card.created',
        cardId: card.id,
        version: 1,
        eventId: scenario.db.eventsFor(card.id).at(0)?.id,
      },
    ])
  })

  it('reuses an existing tag on a case-insensitive match, preserving stored case', async () => {
    // Arrange
    const scenario = createScenario()
    scenario.db.seedTag({ id: fixtureId(900), name: 'Pump' })

    // Act
    const card = await scenario.cards.create(scenario.actors.requester, {
      title: 'Inspect pump',
      tags: ['pump', 'PUMP', 'new-tag'],
    })

    // Assert
    expect(scenario.db.tagNamesFor(card.id)).toEqual(['Pump', 'new-tag'])
  })

  it('records origin mcp and the adapter-resolved reporter for MCP creations', async () => {
    // Arrange
    const scenario = createScenario()

    // Act
    const card = await scenario.cards.create(
      scenario.actors.mcpReadWrite,
      { title: 'Agent-created' },
      { reporterId: scenario.systemUser.id },
    )

    // Assert
    expect(card.origin).toBe('mcp')
    expect(card.reporterId).toBe(scenario.systemUser.id)
    expect(scenario.db.eventsFor(card.id).at(0)?.actorKind).toBe('mcp')
  })

  it('rejects a client-supplied reporterId in the body (reporter impersonation)', async () => {
    // Arrange
    const scenario = createScenario()

    // Act
    const act = scenario.cards.create(scenario.actors.requester, {
      title: 'Impersonated',
      reporterId: scenario.users.supervisor.id,
    })

    // Assert
    await expect(act).rejects.toBeInstanceOf(ZodError)
    expect(scenario.db.cardsInLane(scenario.lanes.intake.id)).toHaveLength(0)
  })

  it('records origin slack and the adapter-trusted Slack source metadata', async () => {
    // Arrange
    const scenario = createScenario()

    // Act
    const card = await scenario.cards.create(
      scenario.actors.slack,
      { title: 'From a thread' },
      {
        slackSource: {
          channelId: 'C0123456789',
          threadTs: '1752666000.000100',
          permalink: 'https://example.slack.com/archives/C0123456789/p1752666000000100',
        },
      },
    )

    // Assert
    expect(card.origin).toBe('slack')
    expect(card.reporterId).toBe(scenario.actors.slack.id)
    expect(card.slackChannelId).toBe('C0123456789')
    expect(card.slackThreadTs).toBe('1752666000.000100')
    expect(card.slackPermalink).toBe(
      'https://example.slack.com/archives/C0123456789/p1752666000000100',
    )
  })

  it('rejects system-actor creation — the pm origin is reserved for a future flow', async () => {
    // Arrange
    const scenario = createScenario()

    // Act
    const act = scenario.cards.create(scenario.actors.system, { title: 'No such flow' })

    // Assert
    await expect(act).rejects.toThrow('system actors do not create cards')
    expect(scenario.db.cardsInLane(scenario.lanes.intake.id)).toHaveLength(0)
  })

  it('fails loudly when the structural policy seed is missing', async () => {
    // Arrange
    const scenario = createScenario({ omitPolicyRecord: true })

    // Act
    const act = scenario.cards.create(scenario.actors.requester, { title: 'No policy row' })

    // Assert
    await expect(act).rejects.toBeInstanceOf(NotFoundError)
    await expect(act).rejects.toMatchObject({ resource: 'policy' })
  })

  it('denies a read-scope token and commits nothing', async () => {
    // Arrange
    const scenario = createScenario()

    // Act
    const act = scenario.cards.create(scenario.actors.mcpRead, { title: 'Blocked write' })

    // Assert
    await expect(act).rejects.toBeInstanceOf(PolicyDeniedError)
    await expect(act).rejects.toMatchObject({ rule: 'token-scope-read' })
    expect(scenario.db.cardsInLane(scenario.lanes.intake.id)).toHaveLength(0)
  })

  it('rejects an unknown assignee', async () => {
    // Arrange
    const scenario = createScenario()

    // Act
    const act = scenario.cards.create(scenario.actors.requester, {
      title: 'Bad assignee',
      assigneeId: fixtureId(999),
    })

    // Assert
    await expect(act).rejects.toBeInstanceOf(NotFoundError)
  })

  it('rejects an MCP creation whose token id resolves to no reporter user', async () => {
    // Arrange
    const scenario = createScenario()

    // Act
    const act = scenario.cards.create(scenario.actors.mcpReadWrite, { title: 'No reporter' })

    // Assert
    await expect(act).rejects.toMatchObject({ resource: 'reporter' })
  })

  it('rejects an unknown location', async () => {
    // Arrange
    const scenario = createScenario()

    // Act
    const act = scenario.cards.create(scenario.actors.requester, {
      title: 'Bad location',
      locationId: fixtureId(998),
    })

    // Assert
    await expect(act).rejects.toBeInstanceOf(NotFoundError)
  })
})
