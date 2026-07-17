import { type Location, type LocationRepository } from '@rivian-kanban/core'
import { eq } from 'drizzle-orm'
import { type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { locations } from '../schema.ts'

export class SqliteLocationRepository implements LocationRepository {
  private readonly db: BetterSQLite3Database

  constructor(db: BetterSQLite3Database) {
    this.db = db
  }

  findById(id: string): Promise<Location | null> {
    const row = this.db.select().from(locations).where(eq(locations.id, id)).get()
    return Promise.resolve(row ?? null)
  }
}
