import { ConflictError } from '../domain/errors.ts'
import { type Actor } from '../domain/entities.ts'
import { policyDocumentSchema, type BoardPolicy } from '../domain/policy.ts'
import { evaluatePolicy } from '../policy/policy-engine.ts'
import { type TransactionContext, type UnitOfWork } from '../ports/repositories.ts'
import { type Clock, type EventBus, type IdGenerator } from '../ports/runtime.ts'
import { decide, requireFound } from './internal.ts'
import { globalPolicy, requireBoardAccess } from './board-access.ts'

export interface PolicyServiceDeps {
  uow: UnitOfWork
  clock: Clock
  ids: IdGenerator
  eventBus: EventBus
  boardId: string
}

/**
 * The configurable permission policy (ADR-013): permissive by default,
 * stored as append-only Zod-validated versions with authorship.
 */
export class PolicyService {
  private readonly deps: PolicyServiceDeps

  constructor(deps: PolicyServiceDeps) {
    this.deps = deps
  }

  /** The newest policy version for the board (drives UI affordances). */
  async getActive(): Promise<BoardPolicy> {
    return this.deps.uow.read(async (tx) => {
      const policy = requireFound(await tx.policies.getActive(this.deps.boardId), 'policy')
      return { ...policy, config: { ...policy.config, roles: (await globalPolicy(tx)).roles } }
    })
  }

  /**
   * Applies a new policy version (append-only; prior versions are history).
   *
   * Policy checks: `managePolicy` grant (read-scope tokens are denied first).
   * Rejects a document that drops a role key still assigned to any active user
   * or live service token (409 `role-in-use`) so nobody is orphaned onto an
   * unknown role. The schema itself already guarantees ≥1 role grants
   * manageRoles, so the edit surface can never lock itself out.
   * Audit events: none on `card_events`; the version row itself is the record.
   * Publishes a board-scoped `policy.updated` hint after commit.
   */
  async apply(actor: Actor, rawDocument: unknown): Promise<BoardPolicy> {
    const config = policyDocumentSchema.parse(rawDocument)
    const record = await this.deps.uow.run(async (tx) => {
      const authority = requireFound(await tx.boards.getDefault(), 'default board')
      const global = requireFound(await tx.policies.getActiveForUpdate(authority.id), 'policy')
      await requireBoardAccess(tx, actor, this.deps.boardId)
      const current = requireFound(
        await tx.policies.getActiveForUpdate(this.deps.boardId),
        'policy',
      ).config
      decide(evaluatePolicy(actor, { type: 'managePolicy' }, global.config))
      // Removing a definition retires it: stored cards/events still resolve the
      // same key, including a cancelled card that is later reopened.
      const keptReasons = new Set(config.waitingReasons.map((reason) => reason.key))
      config.waitingReasons = [
        ...config.waitingReasons,
        ...current.waitingReasons
          .filter((reason) => !keptReasons.has(reason.key))
          .map((reason) => ({ ...reason, active: false })),
      ]
      await ensureNoOrphanedRole(
        tx,
        config.roles.map((role) => role.key),
      )
      for (const role of global.config.roles) {
        if (!config.roles.some((kept) => kept.key === role.key))
          await tx.boards.setDefault('role', role.key, null)
      }
      const version: BoardPolicy = {
        id: this.deps.ids.newId(),
        boardId: this.deps.boardId,
        config,
        createdBy: actor.id,
        createdAt: this.deps.clock.now().toISOString(),
      }
      await tx.policies.insert(version)
      if (
        authority.id !== this.deps.boardId &&
        JSON.stringify(global.config.roles) !== JSON.stringify(config.roles)
      ) {
        await tx.policies.insert({
          ...version,
          id: this.deps.ids.newId(),
          boardId: authority.id,
          config: { ...global.config, roles: config.roles },
        })
      }
      return version
    })
    this.deps.eventBus.publish({ type: 'policy.updated' })
    return record
  }
}

/**
 * Rejects applying a policy whose role set no longer contains a key that an
 * ACTIVE user or a LIVE (non-revoked) service token is assigned. Deactivated
 * users and revoked tokens are ignored — they cannot act, so an orphaned role
 * on them is harmless. Named 409 (`role-in-use`) so the dashboard can surface
 * it inline when an admin tries to delete a role that is still assigned.
 */
async function ensureNoOrphanedRole(
  tx: TransactionContext,
  keptKeys: readonly string[],
): Promise<void> {
  const kept = new Set(keptKeys)
  for (const board of await tx.boards.list()) {
    if (board.allowedRoleKeys.some((key) => !kept.has(key))) {
      throw new ConflictError('role-in-use: role is assigned to a board')
    }
  }
  const users = await tx.userAccounts.list()
  const orphanedUser = users.find((user) => user.isActive && !kept.has(user.role))
  if (orphanedUser !== undefined) {
    throw new ConflictError(`role-in-use: role "${orphanedUser.role}" is assigned to a user`)
  }
  const tokens = await tx.serviceTokens.list()
  const orphanedToken = tokens.find((token) => token.revokedAt === null && !kept.has(token.role))
  if (orphanedToken !== undefined) {
    throw new ConflictError(`role-in-use: role "${orphanedToken.role}" is assigned to a token`)
  }
}
