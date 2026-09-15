import { type Actor, type Board, type Card } from '../domain/entities.ts'
import { NotFoundError } from '../domain/errors.ts'
import { hasPermission } from '../policy/policy-engine.ts'
import { type TransactionContext } from '../ports/repositories.ts'
import { globalPolicy, requireFound } from './internal.ts'

/** Roles are application-wide; the initial board is a permanent authority reference. */
export { globalPolicy } from './internal.ts'

export async function canAccessBoard(
  tx: TransactionContext,
  actor: Actor,
  board: Board,
): Promise<boolean> {
  if (board.archivedAt !== null) return false
  if (hasPermission(actor, 'managePolicy', await globalPolicy(tx))) return true
  if (board.accessMode === 'all' || board.allowedRoleKeys.includes(actor.role)) return true
  // A service token is its own identity: only role grants apply, never its creator's memberships.
  if (actor.kind === 'mcp') return false
  if (board.allowedUserIds.includes(actor.id)) return true
  for (const id of board.allowedGroupIds) {
    if ((await tx.groups.findById(id))?.userIds.includes(actor.id)) return true
  }
  return false
}

export async function requireBoardAccess(
  tx: TransactionContext,
  actor: Actor,
  boardId: string,
): Promise<Board> {
  const board = requireFound(await tx.boards.findById(boardId), 'board')
  if (!(await canAccessBoard(tx, actor, board))) throw new NotFoundError('board')
  return board
}

/** Always before version checks: conflict payloads contain the current card. */
export async function accessibleCard(
  tx: TransactionContext,
  actor: Actor,
  cardId: number,
): Promise<Card> {
  const card = requireFound(await tx.cards.findById(cardId), 'card')
  await requireBoardAccess(tx, actor, card.boardId)
  return card
}

export async function visibleBoardIds(tx: TransactionContext, actor: Actor): Promise<string[]> {
  const result: string[] = []
  for (const board of await tx.boards.list()) {
    if (await canAccessBoard(tx, actor, board)) result.push(board.id)
  }
  return result
}
