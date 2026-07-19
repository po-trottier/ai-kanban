import {
  ConflictError,
  NotFoundError,
  type ServiceToken,
  type ServiceTokenRepository,
} from '@rivian-kanban/core'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { isUniqueViolation, toError } from '../../errors.ts'
import { serviceTokens } from '../../schema.pg.ts'
import { type PgDb } from '../database.ts'

/**
 * MCP/automation bearer credentials (ADR-009). Rows are never deleted:
 * revocation sets `revoked_at`, keeping the issued-credential history.
 */
export class PgServiceTokenRepository implements ServiceTokenRepository {
  private readonly db: PgDb

  constructor(db: PgDb) {
    this.db = db
  }

  async findByHash(tokenHash: string): Promise<ServiceToken | null> {
    const rows = await this.db
      .select()
      .from(serviceTokens)
      .where(eq(serviceTokens.tokenHash, tokenHash))
      .limit(1)
    return rows[0] ?? null
  }

  async updateLastUsed(id: string, lastUsedAt: string): Promise<void> {
    const updated = await this.db
      .update(serviceTokens)
      .set({ lastUsedAt })
      .where(eq(serviceTokens.id, id))
      .returning({ id: serviceTokens.id })
    if (updated.length === 0) throw new NotFoundError('service token')
  }

  async list(): Promise<ServiceToken[]> {
    return this.db
      .select()
      .from(serviceTokens)
      .orderBy(desc(serviceTokens.createdAt), desc(serviceTokens.id))
  }

  async insert(token: ServiceToken): Promise<void> {
    try {
      await this.db.insert(serviceTokens).values(token)
    } catch (error) {
      // The DB-enforced credential-uniqueness backstop (port contract).
      if (isUniqueViolation(error, ['service_tokens.token_hash'])) {
        throw new ConflictError('service token hash already exists')
      }
      throw toError(error)
    }
  }

  /** Idempotent: an already-revoked token keeps its original revokedAt. */
  async revoke(id: string, revokedAt: string): Promise<void> {
    const exists = await this.db
      .select({ id: serviceTokens.id })
      .from(serviceTokens)
      .where(eq(serviceTokens.id, id))
      .limit(1)
    if (exists[0] === undefined) throw new NotFoundError('service token')
    await this.db
      .update(serviceTokens)
      .set({ revokedAt })
      .where(and(eq(serviceTokens.id, id), isNull(serviceTokens.revokedAt)))
  }

  async rotateHash(id: string, tokenHash: string): Promise<ServiceToken> {
    // Read first (like revoke): a dead credential cannot be revived, and an
    // unknown id and a revoked one need different errors.
    const rows = await this.db
      .select()
      .from(serviceTokens)
      .where(eq(serviceTokens.id, id))
      .limit(1)
    const row = rows[0]
    if (row === undefined) throw new NotFoundError('service token')
    if (row.revokedAt !== null) throw new ConflictError('service token is revoked')
    await this.db.update(serviceTokens).set({ tokenHash }).where(eq(serviceTokens.id, id))
    return { ...row, tokenHash }
  }
}
