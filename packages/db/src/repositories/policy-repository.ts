import { boardPolicySchema, type BoardPolicy, type PolicyRepository } from '@rivian-kanban/core'
import { desc, eq } from 'drizzle-orm'
import { type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { toError } from '../errors.ts'
import { boardPolicies } from '../schema.ts'

export class SqlitePolicyRepository implements PolicyRepository {
  private readonly db: BetterSQLite3Database

  constructor(db: BetterSQLite3Database) {
    this.db = db
  }

  /**
   * Newest policy version for the board (append-only, newest wins — ADR-013).
   * UUIDv7 ids are time-ordered, so `id DESC` breaks created_at ties toward
   * the later insert. The stored config JSON is re-validated on hydration
   * (single-schema rule): a corrupt policy row must fail loudly, never
   * evaluate permissively.
   */
  getActive(boardId: string): Promise<BoardPolicy | null> {
    const row = this.db
      .select()
      .from(boardPolicies)
      .where(eq(boardPolicies.boardId, boardId))
      .orderBy(desc(boardPolicies.createdAt), desc(boardPolicies.id))
      .limit(1)
      .get()
    return Promise.resolve(row === undefined ? null : boardPolicySchema.parse(row))
  }

  /** Append-only: never updates or deletes prior versions. */
  insert(policy: BoardPolicy): Promise<void> {
    try {
      this.db.insert(boardPolicies).values(policy).run()
      return Promise.resolve()
    } catch (error) {
      return Promise.reject(toError(error))
    }
  }
}
