import { type Board, type BoardRepository } from '@rivian-kanban/core'
import { asc, eq, isNull } from 'drizzle-orm'
import { and, ne, or } from 'drizzle-orm'
import { type BoardDefault } from '@rivian-kanban/core'
import { boardDefaults } from '../schema.ts'
import { type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { toError } from '../errors.ts'
import { boards } from '../schema.ts'

/**
 * Multiple boards (docs/superpowers/plans/2026-09-15-multiple-boards.md). The
 * original v1 board carries `isDefault = true` permanently — enforced by the
 * `boards_is_default_unique` partial index (schema.ts), so at most one row
 * can ever be flagged. `list()` returns active (non-archived) boards only;
 * `findById`/`getDefault` return archived rows too (a board's policy/history
 * stays reachable after archival).
 */
export class SqliteBoardRepository implements BoardRepository {
  listDefaults(userId: string | null): Promise<BoardDefault[]> {
    return Promise.resolve(
      this.db
        .select()
        .from(boardDefaults)
        .where(
          or(
            ne(boardDefaults.scope, 'user'),
            userId === null ? undefined : eq(boardDefaults.subject, userId),
          ),
        )
        .all(),
    )
  }

  setDefault(scope: BoardDefault['scope'], subject: string, boardId: string | null): Promise<void> {
    if (boardId === null)
      this.db
        .delete(boardDefaults)
        .where(and(eq(boardDefaults.scope, scope), eq(boardDefaults.subject, subject)))
        .run()
    else
      this.db
        .insert(boardDefaults)
        .values({ scope, subject, boardId })
        .onConflictDoUpdate({
          target: [boardDefaults.scope, boardDefaults.subject],
          set: { boardId },
        })
        .run()
    return Promise.resolve()
  }
  private readonly db: BetterSQLite3Database

  constructor(db: BetterSQLite3Database) {
    this.db = db
  }

  private static hydrate(row: typeof boards.$inferSelect): Board {
    return row
  }

  findById(id: string): Promise<Board | null> {
    const row = this.db.select().from(boards).where(eq(boards.id, id)).get()
    return Promise.resolve(row ? SqliteBoardRepository.hydrate(row) : null)
  }

  /** The permanently-flagged default board (present even if archived). */
  getDefault(): Promise<Board | null> {
    const row = this.db.select().from(boards).where(eq(boards.isDefault, true)).get()
    return Promise.resolve(row ? SqliteBoardRepository.hydrate(row) : null)
  }

  /** Active (non-archived) boards, oldest-first. */
  list(): Promise<Board[]> {
    const rows = this.db
      .select()
      .from(boards)
      .where(isNull(boards.archivedAt))
      .orderBy(asc(boards.createdAt), asc(boards.id))
      .all()
    return Promise.resolve(rows.map((row) => SqliteBoardRepository.hydrate(row)))
  }

  insert(board: Board): Promise<void> {
    try {
      this.db.insert(boards).values(board).run()
      return Promise.resolve()
    } catch (error) {
      return Promise.reject(toError(error))
    }
  }

  /** Persists every field (name, archivedAt, accessMode, allowedRoleKeys, allowedUserIds, isDefault). */
  update(board: Board): Promise<void> {
    try {
      this.db.update(boards).set(board).where(eq(boards.id, board.id)).run()
      return Promise.resolve()
    } catch (error) {
      return Promise.reject(toError(error))
    }
  }
}
