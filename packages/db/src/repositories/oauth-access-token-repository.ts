import { type OAuthAccessToken, type OAuthAccessTokenRepository } from '@rivian-kanban/core'
import { and, eq, isNull } from 'drizzle-orm'
import { type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { toError } from '../errors.ts'
import { oauthAccessTokens } from '../schema.ts'

/**
 * Opaque, sha256-hashed OAuth access tokens for the `/mcp` audience (ADR-021).
 * `findByHash` returns the row even when revoked/expired — the caller checks the
 * timestamps — so every `/mcp` request is one indexed hash lookup (like sessions).
 */
export class SqliteOAuthAccessTokenRepository implements OAuthAccessTokenRepository {
  private readonly db: BetterSQLite3Database

  constructor(db: BetterSQLite3Database) {
    this.db = db
  }

  insert(token: OAuthAccessToken): Promise<void> {
    try {
      this.db.insert(oauthAccessTokens).values(token).run()
      return Promise.resolve()
    } catch (error) {
      return Promise.reject(toError(error))
    }
  }

  findByHash(tokenHash: string): Promise<OAuthAccessToken | null> {
    const row = this.db
      .select()
      .from(oauthAccessTokens)
      .where(eq(oauthAccessTokens.tokenHash, tokenHash))
      .get()
    return Promise.resolve(row ?? null)
  }

  updateLastUsed(id: string, lastUsedAt: string): Promise<void> {
    this.db.update(oauthAccessTokens).set({ lastUsedAt }).where(eq(oauthAccessTokens.id, id)).run()
    return Promise.resolve()
  }

  /** Idempotent: only stamps `revoked_at` while still null; a missing id is a no-op. */
  revoke(id: string): Promise<void> {
    this.db
      .update(oauthAccessTokens)
      .set({ revokedAt: new Date().toISOString() })
      .where(and(eq(oauthAccessTokens.id, id), isNull(oauthAccessTokens.revokedAt)))
      .run()
    return Promise.resolve()
  }

  revokeForUser(userId: string): Promise<void> {
    this.db
      .update(oauthAccessTokens)
      .set({ revokedAt: new Date().toISOString() })
      .where(and(eq(oauthAccessTokens.userId, userId), isNull(oauthAccessTokens.revokedAt)))
      .run()
    return Promise.resolve()
  }
}
