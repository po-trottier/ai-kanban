import { type Lane, type LaneKey, type LaneRepository } from '@rivian-kanban/core'
import { and, asc, eq } from 'drizzle-orm'
import { type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
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
      .where(and(eq(lanes.boardId, boardId), eq(lanes.key, key as LaneKey)))
      .get()
    return Promise.resolve(row ?? null)
  }
}
