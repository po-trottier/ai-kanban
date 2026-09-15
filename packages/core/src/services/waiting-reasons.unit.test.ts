import { describe, expect, it } from 'vitest'
import { DEFAULT_POLICY_DOCUMENT } from '../domain/policy.ts'
import { createScenario } from '../testing/index.ts'

describe('configurable waiting reasons', () => {
  it('accepts a configured reason and rejects an unknown reason on entry and edit', async () => {
    // Arrange
    const scenario = createScenario()
    await scenario.policies.apply(scenario.actors.admin, {
      ...DEFAULT_POLICY_DOCUMENT,
      waitingReasons: [{ key: 'inspection', label: 'Inspection', active: true }],
    })
    const card = scenario.seedCard({ laneId: scenario.lanes.intake.id })
    // Act
    const waiting = await scenario.cards.move(scenario.actors.technician, card.id, {
      toLane: 'waiting_parts_vendor',
      expectedVersion: card.version,
      waitingReason: 'inspection',
      expectedResumeAt: '2026-10-01',
    })
    // Assert
    expect(waiting.waitingReason).toBe('inspection')
    await expect(
      scenario.cards.update(scenario.actors.technician, card.id, {
        expectedVersion: waiting.version,
        waitingReason: 'unknown',
      }),
    ).rejects.toThrow('waiting reason is unavailable')
    const other = scenario.seedCard({ laneId: scenario.lanes.intake.id })
    await expect(
      scenario.cards.move(scenario.actors.technician, other.id, {
        toLane: 'waiting_parts_vendor',
        expectedVersion: other.version,
        waitingReason: 'unknown',
        expectedResumeAt: '2026-10-01',
      }),
    ).rejects.toThrow('waiting reason is unavailable')
  })

  it('retains removed reasons for existing cards, date edits and cancellation/reopening', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard({ laneId: scenario.lanes.intake.id })
    const waiting = await scenario.cards.move(scenario.actors.technician, card.id, {
      toLane: 'waiting_parts_vendor',
      expectedVersion: card.version,
      waitingReason: 'parts',
      expectedResumeAt: '2026-10-01',
    })
    // Act
    const policy = await scenario.policies.apply(scenario.actors.admin, {
      ...DEFAULT_POLICY_DOCUMENT,
      waitingReasons: [{ key: 'inspection', label: 'Inspection', active: true }],
    })
    // Assert
    expect(policy.config.waitingReasons).toContainEqual({
      key: 'parts',
      label: 'Parts',
      active: false,
    })
    const updated = await scenario.cards.update(scenario.actors.technician, card.id, {
      expectedVersion: waiting.version,
      waitingReason: 'parts',
      expectedResumeAt: '2026-10-02',
    })
    expect(updated.waitingReason).toBe('parts')
    const cancelled = await scenario.cards.cancel(scenario.actors.technician, card.id, {
      expectedVersion: updated.version,
      resolution: 'cancelled',
    })
    const reopened = await scenario.cards.reopen(scenario.actors.technician, card.id, {
      expectedVersion: cancelled.version,
    })
    expect(reopened.waitingReason).toBe('parts')
    const other = scenario.seedCard({ laneId: scenario.lanes.intake.id })
    await expect(
      scenario.cards.move(scenario.actors.technician, other.id, {
        toLane: 'waiting_parts_vendor',
        expectedVersion: other.version,
        waitingReason: 'parts',
        expectedResumeAt: '2026-10-01',
      }),
    ).rejects.toThrow('waiting reason is unavailable')
  })
})
