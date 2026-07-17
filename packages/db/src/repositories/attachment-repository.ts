import { NotFoundError, type Attachment, type AttachmentRepository } from '@rivian-kanban/core'
import { asc, eq } from 'drizzle-orm'
import { type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { toError } from '../errors.ts'
import { attachments } from '../schema.ts'

export class SqliteAttachmentRepository implements AttachmentRepository {
  private readonly db: BetterSQLite3Database

  constructor(db: BetterSQLite3Database) {
    this.db = db
  }

  findById(id: string): Promise<Attachment | null> {
    const row = this.db.select().from(attachments).where(eq(attachments.id, id)).get()
    return Promise.resolve(row ?? null)
  }

  insert(attachment: Attachment): Promise<void> {
    try {
      this.db.insert(attachments).values(attachment).run()
      return Promise.resolve()
    } catch (error) {
      return Promise.reject(toError(error))
    }
  }

  update(attachment: Attachment): Promise<void> {
    try {
      const result = this.db
        .update(attachments)
        .set(attachment)
        .where(eq(attachments.id, attachment.id))
        .run()
      if (result.changes === 0) return Promise.reject(new NotFoundError('attachment'))
      return Promise.resolve()
    } catch (error) {
      return Promise.reject(toError(error))
    }
  }

  /** Oldest-first; id tie-break keeps equal-timestamp rows deterministic. */
  listByCard(cardId: string): Promise<Attachment[]> {
    const rows = this.db
      .select()
      .from(attachments)
      .where(eq(attachments.cardId, cardId))
      .orderBy(asc(attachments.createdAt), asc(attachments.id))
      .all()
    return Promise.resolve(rows)
  }
}
