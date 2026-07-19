import { ConflictError, NotFoundError, type Lane, type LaneRepository } from '@rivian-kanban/core'
import { and, asc, eq } from 'drizzle-orm'
import { type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { toError } from '../errors.ts'
import { lanes } from '../schema.ts'

export class SqliteLaneRepository implements LaneRepository {
  private readonly db: BetterSQLite3Database

  constructor(db: BetterSQLite3Database) {
    this.db = db
  }

  /** Board order (position ascending). */
  listByBoard(boardId: string): Promise<Lane[]> {
    const rows = this.db
      .select()
      .from(lanes)
      .where(eq(lanes.boardId, boardId))
      .orderBy(asc(lanes.position))
      .all()
    return Promise.resolve(rows)
  }

  findByKey(boardId: string, key: string): Promise<Lane | null> {
    const row = this.db
      .select()
      .from(lanes)
      .where(and(eq(lanes.boardId, boardId), eq(lanes.key, key)))
      .get()
    return Promise.resolve(row ?? null)
  }

  /** Label/WIP-limit edits (position is rewritten via reorder, key never changes). */
  update(lane: Lane): Promise<void> {
    try {
      const result = this.db
        .update(lanes)
        .set({ label: lane.label, wipLimit: lane.wipLimit })
        .where(eq(lanes.id, lane.id))
        .run()
      if (result.changes === 0) return Promise.reject(new NotFoundError('lane'))
      return Promise.resolve()
    } catch (error) {
      return Promise.reject(toError(error))
    }
  }

  insert(lane: Lane): Promise<void> {
    try {
      this.db.insert(lanes).values(lane).run()
      return Promise.resolve()
    } catch (error) {
      return Promise.reject(toError(error))
    }
  }

  remove(laneId: string): Promise<void> {
    try {
      const result = this.db.delete(lanes).where(eq(lanes.id, laneId)).run()
      if (result.changes === 0) return Promise.reject(new NotFoundError('lane'))
      return Promise.resolve()
    } catch (error) {
      // A foreign-key violation means a card still points at the lane — the
      // service guards emptiness first, but surface a clean conflict otherwise.
      const wrapped = toError(error)
      if (wrapped instanceof Error && /FOREIGN KEY/i.test(wrapped.message)) {
        return Promise.reject(new ConflictError('lane still has cards'))
      }
      return Promise.reject(wrapped)
    }
  }

  reorder(boardId: string, orderedIds: string[]): Promise<void> {
    try {
      this.db.transaction((tx) => {
        orderedIds.forEach((laneId, index) => {
          tx.update(lanes)
            .set({ position: index })
            .where(and(eq(lanes.boardId, boardId), eq(lanes.id, laneId)))
            .run()
        })
      })
      return Promise.resolve()
    } catch (error) {
      return Promise.reject(toError(error))
    }
  }
}
