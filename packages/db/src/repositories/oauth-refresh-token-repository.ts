import { type OAuthRefreshToken, type OAuthRefreshTokenRepository } from '@rivian-kanban/core'
import { and, eq, isNull } from 'drizzle-orm'
import { type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { toError } from '../errors.ts'
import { oauthRefreshTokens } from '../schema.ts'

/**
 * Rotating, sha256-hashed OAuth refresh tokens (ADR-021). `markUsed` is the
 * rotation gate and reuse detector: a guarded `UPDATE … WHERE used_at IS NULL`
 * claims an unused token, and 0 changes means a replay of a spent one.
 */
export class SqliteOAuthRefreshTokenRepository implements OAuthRefreshTokenRepository {
  private readonly db: BetterSQLite3Database

  constructor(db: BetterSQLite3Database) {
    this.db = db
  }

  insert(token: OAuthRefreshToken): Promise<void> {
    try {
      this.db.insert(oauthRefreshTokens).values(token).run()
      return Promise.resolve()
    } catch (error) {
      return Promise.reject(toError(error))
    }
  }

  findByHash(tokenHash: string): Promise<OAuthRefreshToken | null> {
    const row = this.db
      .select()
      .from(oauthRefreshTokens)
      .where(eq(oauthRefreshTokens.tokenHash, tokenHash))
      .get()
    return Promise.resolve(row ?? null)
  }

  markUsed(id: string): Promise<boolean> {
    // Atomic rotation claim: only the first caller flips `used_at` from null, so
    // exactly one row changes; 0 changes ⇒ already used (replay) or absent.
    const result = this.db
      .update(oauthRefreshTokens)
      .set({ usedAt: new Date().toISOString() })
      .where(and(eq(oauthRefreshTokens.id, id), isNull(oauthRefreshTokens.usedAt)))
      .run()
    return Promise.resolve(result.changes === 1)
  }

  revokeFamily(familyId: string): Promise<void> {
    this.db
      .update(oauthRefreshTokens)
      .set({ revokedAt: new Date().toISOString() })
      .where(and(eq(oauthRefreshTokens.familyId, familyId), isNull(oauthRefreshTokens.revokedAt)))
      .run()
    return Promise.resolve()
  }

  revokeForUser(userId: string): Promise<void> {
    this.db
      .update(oauthRefreshTokens)
      .set({ revokedAt: new Date().toISOString() })
      .where(and(eq(oauthRefreshTokens.userId, userId), isNull(oauthRefreshTokens.revokedAt)))
      .run()
    return Promise.resolve()
  }
}
