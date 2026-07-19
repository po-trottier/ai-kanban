import { boardPolicySchema, type BoardPolicy, type PolicyRepository } from '@rivian-kanban/core'
import { desc, eq } from 'drizzle-orm'
import { toError } from '../../errors.ts'
import { boardPolicies } from '../../schema.pg.ts'
import { type PgDb } from '../database.ts'

export class PgPolicyRepository implements PolicyRepository {
  private readonly db: PgDb

  constructor(db: PgDb) {
    this.db = db
  }

  /**
   * Newest policy version for the board (append-only, newest wins — ADR-013).
   * UUIDv7 ids are time-ordered, so `id DESC` breaks created_at ties toward
   * the later insert. The stored config JSON is re-validated on hydration
   * (single-schema rule): a corrupt policy row must fail loudly, never
   * evaluate permissively.
   */
  async getActive(boardId: string): Promise<BoardPolicy | null> {
    const rows = await this.db
      .select()
      .from(boardPolicies)
      .where(eq(boardPolicies.boardId, boardId))
      .orderBy(desc(boardPolicies.createdAt), desc(boardPolicies.id))
      .limit(1)
    return rows[0] === undefined ? null : boardPolicySchema.parse(rows[0])
  }

  /** Append-only: never updates or deletes prior versions. */
  async insert(policy: BoardPolicy): Promise<void> {
    try {
      await this.db.insert(boardPolicies).values(policy)
    } catch (error) {
      throw toError(error)
    }
  }
}
