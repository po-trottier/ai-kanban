import { type OAuthClient, type OAuthClientRepository } from '@rivian-kanban/core'
import { eq } from 'drizzle-orm'
import { toError } from '../../errors.ts'
import { oauthClients } from '../../schema.pg.ts'
import { type PgDb } from '../database.ts'

/** Dynamically-registered OAuth clients (ADR-021) — pg twin. */
export class PgOAuthClientRepository implements OAuthClientRepository {
  private readonly db: PgDb

  constructor(db: PgDb) {
    this.db = db
  }

  async findById(id: string): Promise<OAuthClient | null> {
    const rows = await this.db.select().from(oauthClients).where(eq(oauthClients.id, id)).limit(1)
    return rows[0] ?? null
  }

  async insert(client: OAuthClient): Promise<void> {
    try {
      await this.db.insert(oauthClients).values(client)
    } catch (error) {
      throw toError(error)
    }
  }
}
