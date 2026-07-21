import { type OAuthClient, type OAuthClientRepository } from '@rivian-kanban/core'
import { eq } from 'drizzle-orm'
import { type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { toError } from '../errors.ts'
import { oauthClients } from '../schema.ts'

/**
 * Dynamically-registered OAuth clients (ADR-021). Open registration for public
 * loopback agents; `id` is the issued `client_id`, `redirect_uris` the JSON
 * exact-match allowlist.
 */
export class SqliteOAuthClientRepository implements OAuthClientRepository {
  private readonly db: BetterSQLite3Database

  constructor(db: BetterSQLite3Database) {
    this.db = db
  }

  findById(id: string): Promise<OAuthClient | null> {
    const row = this.db.select().from(oauthClients).where(eq(oauthClients.id, id)).get()
    return Promise.resolve(row ?? null)
  }

  insert(client: OAuthClient): Promise<void> {
    try {
      this.db.insert(oauthClients).values(client).run()
      return Promise.resolve()
    } catch (error) {
      return Promise.reject(toError(error))
    }
  }
}
