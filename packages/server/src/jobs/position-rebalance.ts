import { generateNKeysBetween } from 'fractional-indexing'
import { type UnitOfWork } from '@rivian-kanban/core'
import { type AdapterLogger } from '../types.ts'

/**
 * Daily fractional-key rebalance (ADR-006): repeated same-spot insertion
 * grows position keys; any lane whose longest ACTIVE key exceeds 100 chars
 * gets fresh short keys. One transaction per lane; NO audit events and no
 * version bumps — rebalancing is not a user-visible reorder.
 *
 * Only active cards are rewritten: the done lane's archive grows without
 * bound, and re-keying it would hold the single writer for O(archive)
 * statements. Archived rows keep their keys; collisions are impossible
 * because every fresh key is generated strictly AFTER the lane's current
 * maximum key (archived rows included via the edge read) — so a fresh key can
 * never equal a key any row still holds, and the rewrite is a single pass
 * that never trips the UNIQUE(laneId, position) backstop. `generateKeyBetween
 * (max, null)` increments the integer part, so the fresh keys are short
 * regardless of how long the outgrown ones were.
 */

const REBALANCE_MAX_KEY_LENGTH = 100

export interface PositionRebalanceDeps {
  uow: UnitOfWork
  logger: AdapterLogger
  boardId: string
}

export async function runPositionRebalance(
  deps: PositionRebalanceDeps,
): Promise<{ rebalancedLanes: number }> {
  const lanes = await deps.uow.read((tx) => tx.lanes.listByBoard(deps.boardId))
  let rebalancedLanes = 0
  for (const lane of lanes) {
    const rebalanced = await deps.uow.run(async (tx) => {
      // Re-read inside the transaction: the lane may have changed since the
      // lanes list was taken.
      const cards = await tx.cards.listByLane(lane.id, { activeOnly: true })
      if (!cards.some((card) => card.position.length > REBALANCE_MAX_KEY_LENGTH)) return false

      const max = await tx.cards.edgeOfLane(lane.id, 'last')
      const keys = generateNKeysBetween(max?.position ?? null, null, cards.length)
      for (const [index, card] of cards.entries()) {
        const position = keys.at(index)
        if (position === undefined) throw new Error('generateNKeysBetween returned too few keys')
        await tx.cards.update({ ...card, position })
      }
      return true
    })
    if (rebalanced) {
      rebalancedLanes += 1
      deps.logger.info({ laneId: lane.id, laneKey: lane.key }, 'lane positions rebalanced')
    }
  }
  return { rebalancedLanes }
}
