import {
  type OAuthAuthorizationCode,
  type OAuthAuthorizationCodeRepository,
} from '@rivian-kanban/core'
import { eq } from 'drizzle-orm'
import { type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { toError } from '../errors.ts'
import { oauthAuthorizationCodes } from '../schema.ts'

/**
 * Short-lived, single-use OAuth authorization codes (ADR-021). `consume` is the
 * single-use gate: a `DELETE … RETURNING` removes and returns the row in one
 * statement, so a replayed code cannot be exchanged twice.
 */
export class SqliteOAuthAuthorizationCodeRepository implements OAuthAuthorizationCodeRepository {
  private readonly db: BetterSQLite3Database

  constructor(db: BetterSQLite3Database) {
    this.db = db
  }

  insert(code: OAuthAuthorizationCode): Promise<void> {
    try {
      this.db.insert(oauthAuthorizationCodes).values(code).run()
      return Promise.resolve()
    } catch (error) {
      return Promise.reject(toError(error))
    }
  }

  consume(codeHash: string): Promise<OAuthAuthorizationCode | null> {
    // Atomic single use: delete-returning. SQLite removes the row and hands it
    // back in the same statement; a second consume finds nothing and returns null.
    const row = this.db
      .delete(oauthAuthorizationCodes)
      .where(eq(oauthAuthorizationCodes.codeHash, codeHash))
      .returning()
      .get()
    return Promise.resolve(row ?? null)
  }
}
