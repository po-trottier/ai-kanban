import { generateNKeysBetween } from 'fractional-indexing'
import { type UnitOfWork } from '@rivian-kanban/core'
import { type AdapterLogger } from '../types.ts'

/**
 * Daily fractional-key rebalance (ADR-006): repeated same-spot insertion
 * grows position keys; any lane whose longest key exceeds 100 chars gets
 * fresh evenly-spaced keys. One transaction per lane; NO audit events and no
 * version bumps — rebalancing is not a user-visible reorder. Archived cards
 * are rewritten too: they share the lane's UNIQUE(laneId, position) space.
 *
 * The rewrite is two-pass inside the transaction: a fresh key may equal a key
 * another card still holds, and SQLite enforces the uniqueness backstop per
 * statement — pass one parks every card on a collision-free temporary key.
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
  const lanes = await deps.uow.run((tx) => tx.lanes.listByBoard(deps.boardId))
  let rebalancedLanes = 0
  for (const lane of lanes) {
    const rebalanced = await deps.uow.run(async (tx) => {
      // Re-read inside the transaction: the lane may have changed since the
      // lanes list was taken.
      const cards = await tx.cards.listByLane(lane.id)
      if (!cards.some((card) => card.position.length > REBALANCE_MAX_KEY_LENGTH)) return false

      for (const card of cards) {
        await tx.cards.update({ ...card, position: `rebalancing:${card.id}` })
      }
      const keys = generateNKeysBetween(null, null, cards.length)
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
