import { ConflictError, NotFoundError, type Lane, type LaneRepository } from '@rivian-kanban/core'
import { and, asc, eq } from 'drizzle-orm'
import { toError } from '../../errors.ts'
import { lanes } from '../../schema.pg.ts'
import { type PgDb } from '../database.ts'

export class PgLaneRepository implements LaneRepository {
  private readonly db: PgDb

  constructor(db: PgDb) {
    this.db = db
  }

  /** Board order (position ascending). */
  async listByBoard(boardId: string): Promise<Lane[]> {
    return this.db
      .select()
      .from(lanes)
      .where(eq(lanes.boardId, boardId))
      .orderBy(asc(lanes.position))
  }

  async findByKey(boardId: string, key: string): Promise<Lane | null> {
    const rows = await this.db
      .select()
      .from(lanes)
      .where(and(eq(lanes.boardId, boardId), eq(lanes.key, key)))
      .limit(1)
    return rows[0] ?? null
  }

  /** Label/WIP-limit edits (position is rewritten via reorder, key never changes). */
  async update(lane: Lane): Promise<void> {
    try {
      const updated = await this.db
        .update(lanes)
        .set({ label: lane.label, wipLimit: lane.wipLimit })
        .where(eq(lanes.id, lane.id))
        .returning({ id: lanes.id })
      if (updated.length === 0) throw new NotFoundError('lane')
    } catch (error) {
      throw toError(error)
    }
  }

  async insert(lane: Lane): Promise<void> {
    try {
      await this.db.insert(lanes).values(lane)
    } catch (error) {
      throw toError(error)
    }
  }

  async remove(laneId: string): Promise<void> {
    try {
      const removed = await this.db
        .delete(lanes)
        .where(eq(lanes.id, laneId))
        .returning({ id: lanes.id })
      if (removed.length === 0) throw new NotFoundError('lane')
    } catch (error) {
      // A foreign-key violation means a card still points at the lane.
      const wrapped = toError(error)
      if (wrapped instanceof Error && /foreign key/i.test(wrapped.message)) {
        throw new ConflictError('lane still has cards')
      }
      throw wrapped
    }
  }

  async reorder(boardId: string, orderedIds: string[]): Promise<void> {
    try {
      for (const [index, laneId] of orderedIds.entries()) {
        await this.db
          .update(lanes)
          .set({ position: index })
          .where(and(eq(lanes.boardId, boardId), eq(lanes.id, laneId)))
      }
    } catch (error) {
      throw toError(error)
    }
  }
}
