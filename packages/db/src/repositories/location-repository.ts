import {
  ConflictError,
  NotFoundError,
  type Location,
  type LocationRepository,
} from '@rivian-kanban/core'
import { asc, eq, sql } from 'drizzle-orm'
import { type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { isForeignKeyViolation, toError } from '../errors.ts'
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

  /**
   * Case-insensitive name lookup (Slack draft resolution). Explicit
   * lower() = lower() — unlike tags.name, this column carries no NOCASE
   * collation, and the unindexed scan is fine here: locations are a small,
   * admin-curated set read on a cold path. Matches the in-memory fake's
   * toLowerCase semantics (ASCII fold).
   */
  findByNameCi(name: string): Promise<Location | null> {
    const row = this.db
      .select()
      .from(locations)
      .where(sql`lower(${locations.name}) = lower(${name})`)
      .get()
    return Promise.resolve(row ?? null)
  }

  /** Every row, (kind, name) order for a stable tree render. */
  list(): Promise<Location[]> {
    const rows = this.db
      .select()
      .from(locations)
      .orderBy(asc(locations.kind), asc(locations.name), asc(locations.id))
      .all()
    return Promise.resolve(rows)
  }

  insert(location: Location): Promise<void> {
    try {
      this.db.insert(locations).values(location).run()
      return Promise.resolve()
    } catch (error) {
      return Promise.reject(toError(error))
    }
  }

  update(location: Location): Promise<void> {
    try {
      const result = this.db
        .update(locations)
        .set({ parentId: location.parentId, kind: location.kind, name: location.name })
        .where(eq(locations.id, location.id))
        .run()
      if (result.changes === 0) return Promise.reject(new NotFoundError('location'))
      return Promise.resolve()
    } catch (error) {
      return Promise.reject(toError(error))
    }
  }

  /**
   * Hard delete; the FK constraints (child locations, cards.location_id) are
   * the race-free backstop — a violation maps to ConflictError (409).
   */
  delete(id: string): Promise<void> {
    try {
      const result = this.db.delete(locations).where(eq(locations.id, id)).run()
      if (result.changes === 0) return Promise.reject(new NotFoundError('location'))
      return Promise.resolve()
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        return Promise.reject(new ConflictError('location is still referenced'))
      }
      return Promise.reject(toError(error))
    }
  }
}
