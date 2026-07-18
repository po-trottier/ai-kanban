import { randomBytes } from 'node:crypto'
import {
  createServiceTokenInputSchema,
  ensurePermission,
  type Actor,
  type Clock,
  type IdGenerator,
  type ServiceToken,
  type UnitOfWork,
} from '@rivian-kanban/core'
import { loadActivePolicy, roleExists } from '../authz.ts'
import { RequestValidationError } from '../errors.ts'
import { hashServiceToken } from './token-hash.ts'

/**
 * Admin-issued MCP bearer credentials (ADR-009,
 * docs/architecture/rest-api.md#admin): raw token = `rkb_` + 32 bytes
 * base64url, shown exactly once at creation; only its sha256 is stored.
 * DELETE revokes (rows are never deleted). Consumption (Authorization
 * header → Actor) is wired by the MCP task.
 */

export interface ServiceTokenServiceDeps {
  uow: UnitOfWork
  clock: Clock
  ids: IdGenerator
  boardId: string
}

export interface CreatedServiceToken {
  token: ServiceToken
  /** The raw `rkb_…` credential — response-only, never persisted or logged. */
  rawToken: string
}

export class ServiceTokenService {
  private readonly deps: ServiceTokenServiceDeps

  constructor(deps: ServiceTokenServiceDeps) {
    this.deps = deps
  }

  /**
   * Policy checks: `manageTokens` grant. Validates that the requested role key
   * is a role defined in the active policy (else 400) — a token must never
   * carry an unknown role, which would default-deny every action it attempts.
   */
  async create(actor: Actor, rawInput: unknown): Promise<CreatedServiceToken> {
    const input = createServiceTokenInputSchema.parse(rawInput)
    const rawToken = `rkb_${randomBytes(32).toString('base64url')}`
    const token: ServiceToken = {
      id: this.deps.ids.newId(),
      name: input.name,
      tokenHash: hashServiceToken(rawToken),
      role: input.role,
      scope: input.scope,
      createdBy: actor.id,
      createdAt: this.deps.clock.now().toISOString(),
      lastUsedAt: null,
      revokedAt: null,
    }
    await this.deps.uow.run(async (tx) => {
      const policy = await loadActivePolicy(tx, this.deps.boardId)
      ensurePermission(actor, 'manageTokens', policy)
      if (!roleExists(policy, input.role)) {
        throw new RequestValidationError('role', `unknown role "${input.role}"`)
      }
      await tx.serviceTokens.insert(token)
    })
    return { token, rawToken }
  }

  /** Policy checks: `manageTokens` grant. */
  async list(actor: Actor): Promise<ServiceToken[]> {
    return this.deps.uow.run(async (tx) => {
      ensurePermission(actor, 'manageTokens', await loadActivePolicy(tx, this.deps.boardId))
      return tx.serviceTokens.list()
    })
  }

  /** Policy checks: `manageTokens` grant. Unknown ids are 404. */
  async revoke(actor: Actor, tokenId: string): Promise<void> {
    const nowIso = this.deps.clock.now().toISOString()
    await this.deps.uow.run(async (tx) => {
      ensurePermission(actor, 'manageTokens', await loadActivePolicy(tx, this.deps.boardId))
      await tx.serviceTokens.revoke(tokenId, nowIso)
    })
  }
}
