import {
  NotFoundError,
  type BoardFilter,
  type FilterPreset,
  type FilterPresetRepository,
} from '@rivian-kanban/core'
import { and, desc, eq, or } from 'drizzle-orm'
import { filterPresets } from '../../schema.pg.ts'
import { type PgDb } from '../database.ts'

/**
 * Saved board filters (docs/architecture/board-filters.md). Reads
 * (`listVisibleTo`) return the caller's own presets plus every team-shared one;
 * every WRITE is scoped by `ownerId`, so a preset owned by another user reads as
 * absent to a writer — the service maps both unknown and not-owned to 404 and
 * never confirms another user's preset exists. `filter` is a JSON column — the
 * drizzle row carries `unknown`, cast to the port's `BoardFilter` on hydration.
 */
export class PgFilterPresetRepository implements FilterPresetRepository {
  private readonly db: PgDb

  constructor(db: PgDb) {
    this.db = db
  }

  private static hydrate(row: typeof filterPresets.$inferSelect): FilterPreset {
    return { ...row, filter: row.filter as BoardFilter }
  }

  async listVisibleTo(userId: string): Promise<FilterPreset[]> {
    const rows = await this.db
      .select()
      .from(filterPresets)
      // The caller's own presets plus every team-shared one.
      .where(or(eq(filterPresets.ownerId, userId), eq(filterPresets.shared, true)))
      .orderBy(desc(filterPresets.createdAt), desc(filterPresets.id))
    return rows.map((row) => PgFilterPresetRepository.hydrate(row))
  }

  async findByIdForOwner(id: string, ownerId: string): Promise<FilterPreset | null> {
    const rows = await this.db
      .select()
      .from(filterPresets)
      .where(and(eq(filterPresets.id, id), eq(filterPresets.ownerId, ownerId)))
      .limit(1)
    return rows[0] ? PgFilterPresetRepository.hydrate(rows[0]) : null
  }

  async insert(preset: FilterPreset): Promise<void> {
    await this.db.insert(filterPresets).values(preset)
  }

  async update(preset: FilterPreset): Promise<void> {
    const updated = await this.db
      .update(filterPresets)
      .set({
        name: preset.name,
        filter: preset.filter,
        shared: preset.shared,
        updatedAt: preset.updatedAt,
      })
      .where(and(eq(filterPresets.id, preset.id), eq(filterPresets.ownerId, preset.ownerId)))
      .returning({ id: filterPresets.id })
    if (updated.length === 0) throw new NotFoundError('filter preset')
  }

  async delete(id: string, ownerId: string): Promise<void> {
    const removed = await this.db
      .delete(filterPresets)
      .where(and(eq(filterPresets.id, id), eq(filterPresets.ownerId, ownerId)))
      .returning({ id: filterPresets.id })
    if (removed.length === 0) throw new NotFoundError('filter preset')
  }
}
