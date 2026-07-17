import { randomBytes } from 'node:crypto'
import {
  ADMIN_ONLY_RULE,
  PolicyDeniedError,
  tokenScopeSchema,
  roleSchema,
  type Actor,
  type Clock,
  type IdGenerator,
  type ServiceToken,
  type UnitOfWork,
} from '@rivian-kanban/core'
import { z } from 'zod'
import { hashServiceToken } from './token-hash.ts'

/**
 * Admin-issued MCP bearer credentials (ADR-009,
 * docs/architecture/rest-api.md#admin): raw token = `rkb_` + 32 bytes
 * base64url, shown exactly once at creation; only its sha256 is stored.
 * DELETE revokes (rows are never deleted). Consumption (Authorization
 * header → Actor) is wired by the MCP task.
 */

export const createServiceTokenInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  role: roleSchema,
  scope: tokenScopeSchema,
})

export interface ServiceTokenServiceDeps {
  uow: UnitOfWork
  clock: Clock
  ids: IdGenerator
}

export interface CreatedServiceToken {
  token: ServiceToken
  /** The raw `rkb_…` credential — response-only, never persisted or logged. */
  rawToken: string
}

function requireAdmin(actor: Actor): void {
  if (actor.role !== 'admin') throw new PolicyDeniedError(ADMIN_ONLY_RULE)
}

export class ServiceTokenService {
  private readonly deps: ServiceTokenServiceDeps

  constructor(deps: ServiceTokenServiceDeps) {
    this.deps = deps
  }

  /** Policy checks: admin only (always-on). */
  async create(actor: Actor, rawInput: unknown): Promise<CreatedServiceToken> {
    requireAdmin(actor)
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
    await this.deps.uow.run((tx) => tx.serviceTokens.insert(token))
    return { token, rawToken }
  }

  /** Policy checks: admin only (always-on). */
  async list(actor: Actor): Promise<ServiceToken[]> {
    requireAdmin(actor)
    return this.deps.uow.run((tx) => tx.serviceTokens.list())
  }

  /** Policy checks: admin only (always-on). Unknown ids are 404. */
  async revoke(actor: Actor, tokenId: string): Promise<void> {
    requireAdmin(actor)
    const nowIso = this.deps.clock.now().toISOString()
    await this.deps.uow.run((tx) => tx.serviceTokens.revoke(tokenId, nowIso))
  }
}
