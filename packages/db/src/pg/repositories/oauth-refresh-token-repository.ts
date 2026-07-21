import { type OAuthRefreshToken, type OAuthRefreshTokenRepository } from '@rivian-kanban/core'
import { and, eq, isNull } from 'drizzle-orm'
import { toError } from '../../errors.ts'
import { oauthRefreshTokens } from '../../schema.pg.ts'
import { type PgDb } from '../database.ts'

/**
 * Rotating, sha256-hashed OAuth refresh tokens (ADR-021) — pg twin. `markUsed`
 * claims an unused token with a guarded `UPDATE … WHERE used_at IS NULL …
 * RETURNING`; an empty return means a replay of a spent token.
 */
export class PgOAuthRefreshTokenRepository implements OAuthRefreshTokenRepository {
  private readonly db: PgDb

  constructor(db: PgDb) {
    this.db = db
  }

  async insert(token: OAuthRefreshToken): Promise<void> {
    try {
      await this.db.insert(oauthRefreshTokens).values(token)
    } catch (error) {
      throw toError(error)
    }
  }

  async findByHash(tokenHash: string): Promise<OAuthRefreshToken | null> {
    const rows = await this.db
      .select()
      .from(oauthRefreshTokens)
      .where(eq(oauthRefreshTokens.tokenHash, tokenHash))
      .limit(1)
    return rows[0] ?? null
  }

  async markUsed(id: string): Promise<boolean> {
    const updated = await this.db
      .update(oauthRefreshTokens)
      .set({ usedAt: new Date().toISOString() })
      .where(and(eq(oauthRefreshTokens.id, id), isNull(oauthRefreshTokens.usedAt)))
      .returning({ id: oauthRefreshTokens.id })
    return updated.length === 1
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.db
      .update(oauthRefreshTokens)
      .set({ revokedAt: new Date().toISOString() })
      .where(and(eq(oauthRefreshTokens.familyId, familyId), isNull(oauthRefreshTokens.revokedAt)))
  }

  async revokeForUser(userId: string): Promise<void> {
    await this.db
      .update(oauthRefreshTokens)
      .set({ revokedAt: new Date().toISOString() })
      .where(and(eq(oauthRefreshTokens.userId, userId), isNull(oauthRefreshTokens.revokedAt)))
  }
}
