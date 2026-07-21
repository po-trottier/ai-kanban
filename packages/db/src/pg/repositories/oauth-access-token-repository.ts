import { type OAuthAccessToken, type OAuthAccessTokenRepository } from '@rivian-kanban/core'
import { and, eq, isNull } from 'drizzle-orm'
import { toError } from '../../errors.ts'
import { oauthAccessTokens } from '../../schema.pg.ts'
import { type PgDb } from '../database.ts'

/** Opaque, sha256-hashed OAuth access tokens (ADR-021) — pg twin. */
export class PgOAuthAccessTokenRepository implements OAuthAccessTokenRepository {
  private readonly db: PgDb

  constructor(db: PgDb) {
    this.db = db
  }

  async insert(token: OAuthAccessToken): Promise<void> {
    try {
      await this.db.insert(oauthAccessTokens).values(token)
    } catch (error) {
      throw toError(error)
    }
  }

  async findByHash(tokenHash: string): Promise<OAuthAccessToken | null> {
    const rows = await this.db
      .select()
      .from(oauthAccessTokens)
      .where(eq(oauthAccessTokens.tokenHash, tokenHash))
      .limit(1)
    return rows[0] ?? null
  }

  async updateLastUsed(id: string, lastUsedAt: string): Promise<void> {
    await this.db.update(oauthAccessTokens).set({ lastUsedAt }).where(eq(oauthAccessTokens.id, id))
  }

  /** Idempotent: only stamps `revoked_at` while still null; a missing id is a no-op. */
  async revoke(id: string): Promise<void> {
    await this.db
      .update(oauthAccessTokens)
      .set({ revokedAt: new Date().toISOString() })
      .where(and(eq(oauthAccessTokens.id, id), isNull(oauthAccessTokens.revokedAt)))
  }

  async revokeForUser(userId: string): Promise<void> {
    await this.db
      .update(oauthAccessTokens)
      .set({ revokedAt: new Date().toISOString() })
      .where(and(eq(oauthAccessTokens.userId, userId), isNull(oauthAccessTokens.revokedAt)))
  }
}
