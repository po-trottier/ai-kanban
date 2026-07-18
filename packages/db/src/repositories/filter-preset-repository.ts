import {
  NotFoundError,
  type BoardFilter,
  type FilterPreset,
  type FilterPresetRepository,
} from '@rivian-kanban/core'
import { and, desc, eq } from 'drizzle-orm'
import { type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { filterPresets } from '../schema.ts'

/**
 * Per-user saved board filters (docs/architecture/board-filters.md). Every
 * method is scoped by `ownerId`: a preset owned by another user reads as absent,
 * so the service maps both unknown and not-owned to 404 and never confirms
 * another user's preset exists. `filter` is a JSON column — the drizzle row
 * carries `unknown`, cast to the port's `BoardFilter` on hydration.
 */
export class SqliteFilterPresetRepository implements FilterPresetRepository {
  private readonly db: BetterSQLite3Database

  constructor(db: BetterSQLite3Database) {
    this.db = db
  }

  private static hydrate(row: typeof filterPresets.$inferSelect): FilterPreset {
    return { ...row, filter: row.filter as BoardFilter }
  }

  listByOwner(ownerId: string): Promise<FilterPreset[]> {
    const rows = this.db
      .select()
      .from(filterPresets)
      .where(eq(filterPresets.ownerId, ownerId))
      .orderBy(desc(filterPresets.createdAt), desc(filterPresets.id))
      .all()
    return Promise.resolve(rows.map((row) => SqliteFilterPresetRepository.hydrate(row)))
  }

  findByIdForOwner(id: string, ownerId: string): Promise<FilterPreset | null> {
    const row = this.db
      .select()
      .from(filterPresets)
      .where(and(eq(filterPresets.id, id), eq(filterPresets.ownerId, ownerId)))
      .get()
    return Promise.resolve(row ? SqliteFilterPresetRepository.hydrate(row) : null)
  }

  insert(preset: FilterPreset): Promise<void> {
    this.db.insert(filterPresets).values(preset).run()
    return Promise.resolve()
  }

  update(preset: FilterPreset): Promise<void> {
    const result = this.db
      .update(filterPresets)
      .set({ name: preset.name, filter: preset.filter, updatedAt: preset.updatedAt })
      .where(and(eq(filterPresets.id, preset.id), eq(filterPresets.ownerId, preset.ownerId)))
      .run()
    if (result.changes === 0) return Promise.reject(new NotFoundError('filter preset'))
    return Promise.resolve()
  }

  delete(id: string, ownerId: string): Promise<void> {
    const result = this.db
      .delete(filterPresets)
      .where(and(eq(filterPresets.id, id), eq(filterPresets.ownerId, ownerId)))
      .run()
    if (result.changes === 0) return Promise.reject(new NotFoundError('filter preset'))
    return Promise.resolve()
  }
}
