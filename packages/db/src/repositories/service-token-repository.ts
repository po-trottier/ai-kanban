import { NotFoundError, type ServiceToken, type ServiceTokenRepository } from '@rivian-kanban/core'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { toError } from '../errors.ts'
import { serviceTokens } from '../schema.ts'

/**
 * MCP/automation bearer credentials (ADR-009). Rows are never deleted:
 * revocation sets `revoked_at`, keeping the issued-credential history.
 */
export class SqliteServiceTokenRepository implements ServiceTokenRepository {
  private readonly db: BetterSQLite3Database

  constructor(db: BetterSQLite3Database) {
    this.db = db
  }

  findByHash(tokenHash: string): Promise<ServiceToken | null> {
    const row = this.db
      .select()
      .from(serviceTokens)
      .where(eq(serviceTokens.tokenHash, tokenHash))
      .get()
    return Promise.resolve(row ?? null)
  }

  updateLastUsed(id: string, lastUsedAt: string): Promise<void> {
    const result = this.db
      .update(serviceTokens)
      .set({ lastUsedAt })
      .where(eq(serviceTokens.id, id))
      .run()
    if (result.changes === 0) return Promise.reject(new NotFoundError('service token'))
    return Promise.resolve()
  }

  list(): Promise<ServiceToken[]> {
    const rows = this.db
      .select()
      .from(serviceTokens)
      .orderBy(desc(serviceTokens.createdAt), desc(serviceTokens.id))
      .all()
    return Promise.resolve(rows)
  }

  insert(token: ServiceToken): Promise<void> {
    try {
      this.db.insert(serviceTokens).values(token).run()
      return Promise.resolve()
    } catch (error) {
      return Promise.reject(toError(error))
    }
  }

  /** Idempotent: an already-revoked token keeps its original revokedAt. */
  revoke(id: string, revokedAt: string): Promise<void> {
    const exists = this.db
      .select({ id: serviceTokens.id })
      .from(serviceTokens)
      .where(eq(serviceTokens.id, id))
      .get()
    if (exists === undefined) return Promise.reject(new NotFoundError('service token'))
    this.db
      .update(serviceTokens)
      .set({ revokedAt })
      .where(and(eq(serviceTokens.id, id), isNull(serviceTokens.revokedAt)))
      .run()
    return Promise.resolve()
  }
}
