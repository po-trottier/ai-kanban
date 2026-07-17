import { NotFoundError, type Location, type LocationRepository } from '@rivian-kanban/core'
import { asc, eq, inArray, sql } from 'drizzle-orm'
import { type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { toError } from '../errors.ts'
import { cards, locations } from '../schema.ts'

/** The subtree ids rooted at `id`, deepest-first (children before parents). */
function collectSubtree(tx: Pick<BetterSQLite3Database, 'select'>, id: string): string[] {
  // The location tree is at most 3 levels deep and admin-curated (tiny), so a
  // breadth-first expansion by `parent_id` is both clear and cheap — and stays
  // portable (no dialect-specific recursive CTE). Levels are appended in
  // increasing depth, then reversed so deletes run children-first. A visited
  // set dedupes ids (parity with the in-memory fake) so a malformed cyclic
  // parent_id graph terminates instead of looping — reparenting is unsupported
  // today, so no code path can create a cycle, but the guard is cheap.
  const levels: string[][] = [[id]]
  const visited = new Set<string>([id])
  let frontier = [id]
  while (frontier.length > 0) {
    const children = tx
      .select({ id: locations.id })
      .from(locations)
      .where(inArray(locations.parentId, frontier))
      .all()
      .map((row) => row.id)
      .filter((childId) => !visited.has(childId))
    if (children.length === 0) break
    for (const childId of children) visited.add(childId)
    levels.push(children)
    frontier = children
  }
  return levels.reverse().flat()
}

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
   * Recursive hard delete of the whole subtree rooted at `id` (building → its
   * floors → their rooms) in ONE transaction. Cards pointing at any removed
   * location have their optional `location_id` cleared — the card survives,
   * just loses the reference. Both `cards.location_id` and
   * `locations.parent_id` are ON DELETE NO ACTION, so with `foreign_keys = ON`
   * we null the referencing cards first, then delete the locations
   * children-first (deepest depth first) so no row is ever orphaned
   * mid-transaction. Rejects with NotFoundError only when `id` does not exist.
   */
  delete(id: string): Promise<void> {
    try {
      this.db.transaction((tx) => {
        // Root missing → NotFoundError. (A root with no children still yields
        // [id] from the walk, so presence is checked explicitly.)
        const exists = tx.select({ id: locations.id }).from(locations).where(eq(locations.id, id))
        if (exists.get() === undefined) throw new NotFoundError('location')
        const subtreeIds = collectSubtree(tx, id)

        // Location is optional: any card referencing a removed node keeps the
        // card, just loses the reference.
        tx.update(cards)
          .set({ locationId: null })
          .where(inArray(cards.locationId, subtreeIds))
          .run()

        // Children-first so each parent is deleted only after its descendants.
        for (const subtreeId of subtreeIds) {
          tx.delete(locations).where(eq(locations.id, subtreeId)).run()
        }
      })
      return Promise.resolve()
    } catch (error) {
      return Promise.reject(toError(error))
    }
  }
}
