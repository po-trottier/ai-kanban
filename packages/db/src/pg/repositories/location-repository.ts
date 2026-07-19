import { NotFoundError, type Location, type LocationRepository } from '@rivian-kanban/core'
import { asc, eq, inArray, sql } from 'drizzle-orm'
import { toError } from '../../errors.ts'
import { cards, locations } from '../../schema.pg.ts'
import { type PgDb } from '../database.ts'

/** The subtree ids rooted at `id`, deepest-first (children before parents). */
async function collectSubtree(tx: PgDb, id: string): Promise<string[]> {
  // The location tree is at most 3 levels deep and admin-curated (tiny), so a
  // breadth-first expansion by `parent_id` is clear, cheap, and dialect-neutral
  // (no recursive CTE). A visited set dedupes ids so a malformed cyclic graph
  // terminates instead of looping.
  const levels: string[][] = [[id]]
  const visited = new Set<string>([id])
  let frontier = [id]
  while (frontier.length > 0) {
    const children = (
      await tx
        .select({ id: locations.id })
        .from(locations)
        .where(inArray(locations.parentId, frontier))
    )
      .map((row) => row.id)
      .filter((childId) => !visited.has(childId))
    if (children.length === 0) break
    for (const childId of children) visited.add(childId)
    levels.push(children)
    frontier = children
  }
  return levels.reverse().flat()
}

export class PgLocationRepository implements LocationRepository {
  private readonly db: PgDb

  constructor(db: PgDb) {
    this.db = db
  }

  async findById(id: string): Promise<Location | null> {
    const rows = await this.db.select().from(locations).where(eq(locations.id, id)).limit(1)
    return rows[0] ?? null
  }

  /**
   * Case-insensitive name lookup (Slack draft resolution). Explicit
   * lower() = lower() — the unindexed scan is fine on this small, admin-curated
   * set read on a cold path.
   */
  async findByNameCi(name: string): Promise<Location | null> {
    const rows = await this.db
      .select()
      .from(locations)
      .where(sql`lower(${locations.name}) = lower(${name})`)
      .limit(1)
    return rows[0] ?? null
  }

  /** Every row, (kind, name) order for a stable tree render. */
  async list(): Promise<Location[]> {
    return this.db
      .select()
      .from(locations)
      .orderBy(asc(locations.kind), asc(locations.name), asc(locations.id))
  }

  async insert(location: Location): Promise<void> {
    try {
      await this.db.insert(locations).values(location)
    } catch (error) {
      throw toError(error)
    }
  }

  async update(location: Location): Promise<void> {
    try {
      const updated = await this.db
        .update(locations)
        .set({ parentId: location.parentId, kind: location.kind, name: location.name })
        .where(eq(locations.id, location.id))
        .returning({ id: locations.id })
      if (updated.length === 0) throw new NotFoundError('location')
    } catch (error) {
      throw toError(error)
    }
  }

  /**
   * Recursive hard delete of the whole subtree rooted at `id` in ONE
   * transaction (a nested savepoint under the unit-of-work). Cards pointing at
   * any removed location have their optional `location_id` cleared first, then
   * the locations are deleted children-first so no row is orphaned mid-delete.
   * Rejects with NotFoundError only when `id` does not exist.
   */
  async delete(id: string): Promise<void> {
    try {
      await this.db.transaction(async (tx) => {
        const exists = await tx
          .select({ id: locations.id })
          .from(locations)
          .where(eq(locations.id, id))
          .limit(1)
        if (exists[0] === undefined) throw new NotFoundError('location')
        const subtreeIds = await collectSubtree(tx, id)

        await tx
          .update(cards)
          .set({ locationId: null })
          .where(inArray(cards.locationId, subtreeIds))

        for (const subtreeId of subtreeIds) {
          await tx.delete(locations).where(eq(locations.id, subtreeId))
        }
      })
    } catch (error) {
      throw toError(error)
    }
  }
}
