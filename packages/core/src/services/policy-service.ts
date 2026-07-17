import { type Actor } from '../domain/entities.ts'
import { policyDocumentSchema, type BoardPolicy } from '../domain/policy.ts'
import { evaluatePolicy } from '../policy/policy-engine.ts'
import { type UnitOfWork } from '../ports/repositories.ts'
import { type Clock, type EventBus, type IdGenerator } from '../ports/runtime.ts'
import { activePolicy, decide, requireFound } from './internal.ts'

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
    return this.deps.uow.run(async (tx) =>
      requireFound(await tx.policies.getActive(this.deps.boardId), 'policy'),
    )
  }

  /**
   * Applies a new policy version (append-only; prior versions are history).
   *
   * Policy checks: `admin` — the admin surface is always role-restricted and
   * cannot be opened up (read-scope tokens are denied first).
   * Audit events: none on `card_events`; the version row itself is the record.
   * Publishes a board-scoped `policy.updated` hint after commit.
   */
  async apply(actor: Actor, rawDocument: unknown): Promise<BoardPolicy> {
    const config = policyDocumentSchema.parse(rawDocument)
    const record = await this.deps.uow.run(async (tx) => {
      const current = await activePolicy(tx, this.deps.boardId)
      decide(evaluatePolicy(actor, { type: 'admin' }, current))
      const version: BoardPolicy = {
        id: this.deps.ids.newId(),
        boardId: this.deps.boardId,
        config,
        createdBy: actor.id,
        createdAt: this.deps.clock.now().toISOString(),
      }
      await tx.policies.insert(version)
      return version
    })
    this.deps.eventBus.publish({ type: 'policy.updated' })
    return record
  }
}
