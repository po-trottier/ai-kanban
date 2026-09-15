import { type Board, type BoardRepository } from '@rivian-kanban/core'
import { asc, eq, isNull } from 'drizzle-orm'
import { and, ne, or } from 'drizzle-orm'
import { type BoardDefault } from '@rivian-kanban/core'
import { boardDefaults } from '../../schema.pg.ts'
import { toError } from '../../errors.ts'
import { boards } from '../../schema.pg.ts'
import { type PgDb } from '../database.ts'

/** Multiple boards — pg twin of `repositories/board-repository.ts` (see its header comment). */
export class PgBoardRepository implements BoardRepository {
  async listDefaults(userId: string | null): Promise<BoardDefault[]> {
    return this.db
      .select()
      .from(boardDefaults)
      .where(
        or(
          ne(boardDefaults.scope, 'user'),
          userId === null ? undefined : eq(boardDefaults.subject, userId),
        ),
      )
  }

  async setDefault(
    scope: BoardDefault['scope'],
    subject: string,
    boardId: string | null,
  ): Promise<void> {
    if (boardId === null)
      await this.db
        .delete(boardDefaults)
        .where(and(eq(boardDefaults.scope, scope), eq(boardDefaults.subject, subject)))
    else
      await this.db
        .insert(boardDefaults)
        .values({ scope, subject, boardId })
        .onConflictDoUpdate({
          target: [boardDefaults.scope, boardDefaults.subject],
          set: { boardId },
        })
  }
  private readonly db: PgDb

  constructor(db: PgDb) {
    this.db = db
  }

  async findById(id: string): Promise<Board | null> {
    const rows = await this.db.select().from(boards).where(eq(boards.id, id)).limit(1)
    return rows[0] ?? null
  }

  /** The permanently-flagged default board (present even if archived). */
  async getDefault(): Promise<Board | null> {
    const rows = await this.db.select().from(boards).where(eq(boards.isDefault, true)).limit(1)
    return rows[0] ?? null
  }

  /** Active (non-archived) boards, oldest-first. */
  async list(): Promise<Board[]> {
    return this.db
      .select()
      .from(boards)
      .where(isNull(boards.archivedAt))
      .orderBy(asc(boards.createdAt), asc(boards.id))
  }

  async insert(board: Board): Promise<void> {
    try {
      await this.db.insert(boards).values(board)
    } catch (error) {
      throw toError(error)
    }
  }

  /** Persists every field (name, archivedAt, accessMode, allowedRoleKeys, allowedUserIds, isDefault). */
  async update(board: Board): Promise<void> {
    try {
      await this.db.update(boards).set(board).where(eq(boards.id, board.id))
    } catch (error) {
      throw toError(error)
    }
  }
}
