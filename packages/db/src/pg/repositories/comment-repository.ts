import { NotFoundError, type Comment, type CommentRepository } from '@rivian-kanban/core'
import { asc, eq } from 'drizzle-orm'
import { toError } from '../../errors.ts'
import { comments } from '../../schema.pg.ts'
import { type PgDb } from '../database.ts'

export class PgCommentRepository implements CommentRepository {
  private readonly db: PgDb

  constructor(db: PgDb) {
    this.db = db
  }

  async findById(id: string): Promise<Comment | null> {
    const rows = await this.db.select().from(comments).where(eq(comments.id, id)).limit(1)
    return rows[0] ?? null
  }

  async insert(comment: Comment): Promise<void> {
    try {
      await this.db.insert(comments).values(comment)
    } catch (error) {
      throw toError(error)
    }
  }

  async update(comment: Comment): Promise<void> {
    try {
      const result = await this.db
        .update(comments)
        .set(comment)
        .where(eq(comments.id, comment.id))
        .returning({ id: comments.id })
      if (result.length === 0) throw new NotFoundError('comment')
    } catch (error) {
      throw toError(error)
    }
  }

  /** Oldest-first on (createdAt, id); soft-deleted rows included (thread shape). */
  async listByCard(cardId: number): Promise<Comment[]> {
    return this.db
      .select()
      .from(comments)
      .where(eq(comments.cardId, cardId))
      .orderBy(asc(comments.createdAt), asc(comments.id))
  }
}
