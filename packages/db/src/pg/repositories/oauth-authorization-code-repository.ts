import {
  type OAuthAuthorizationCode,
  type OAuthAuthorizationCodeRepository,
} from '@rivian-kanban/core'
import { eq } from 'drizzle-orm'
import { toError } from '../../errors.ts'
import { oauthAuthorizationCodes } from '../../schema.pg.ts'
import { type PgDb } from '../database.ts'

/**
 * Short-lived, single-use OAuth authorization codes (ADR-021) — pg twin.
 * `consume` is `DELETE … RETURNING`, so a code is exchanged at most once even
 * under concurrency (Postgres removes and returns the row atomically).
 */
export class PgOAuthAuthorizationCodeRepository implements OAuthAuthorizationCodeRepository {
  private readonly db: PgDb

  constructor(db: PgDb) {
    this.db = db
  }

  async insert(code: OAuthAuthorizationCode): Promise<void> {
    try {
      await this.db.insert(oauthAuthorizationCodes).values(code)
    } catch (error) {
      throw toError(error)
    }
  }

  async consume(codeHash: string): Promise<OAuthAuthorizationCode | null> {
    const deleted = await this.db
      .delete(oauthAuthorizationCodes)
      .where(eq(oauthAuthorizationCodes.codeHash, codeHash))
      .returning()
    return deleted[0] ?? null
  }
}
