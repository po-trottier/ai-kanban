import { NotFoundError, type Comment, type CommentRepository } from '@rivian-kanban/core'
import { asc, eq } from 'drizzle-orm'
import { type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { toError } from '../errors.ts'
import { comments } from '../schema.ts'

export class SqliteCommentRepository implements CommentRepository {
  private readonly db: BetterSQLite3Database

  constructor(db: BetterSQLite3Database) {
    this.db = db
  }

  findById(id: string): Promise<Comment | null> {
    const row = this.db.select().from(comments).where(eq(comments.id, id)).get()
    return Promise.resolve(row ?? null)
  }

  insert(comment: Comment): Promise<void> {
    try {
      this.db.insert(comments).values(comment).run()
      return Promise.resolve()
    } catch (error) {
      return Promise.reject(toError(error))
    }
  }

  update(comment: Comment): Promise<void> {
    try {
      const result = this.db.update(comments).set(comment).where(eq(comments.id, comment.id)).run()
      if (result.changes === 0) return Promise.reject(new NotFoundError('comment'))
      return Promise.resolve()
    } catch (error) {
      return Promise.reject(toError(error))
    }
  }

  /** Oldest-first on (createdAt, id); soft-deleted rows included (thread shape). */
  listByCard(cardId: number): Promise<Comment[]> {
    const rows = this.db
      .select()
      .from(comments)
      .where(eq(comments.cardId, cardId))
      .orderBy(asc(comments.createdAt), asc(comments.id))
      .all()
    return Promise.resolve(rows)
  }
}
