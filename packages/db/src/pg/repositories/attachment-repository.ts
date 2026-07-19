import { NotFoundError, type Attachment, type AttachmentRepository } from '@rivian-kanban/core'
import { asc, eq } from 'drizzle-orm'
import { toError } from '../../errors.ts'
import { attachments } from '../../schema.pg.ts'
import { type PgDb } from '../database.ts'

export class PgAttachmentRepository implements AttachmentRepository {
  private readonly db: PgDb

  constructor(db: PgDb) {
    this.db = db
  }

  async findById(id: string): Promise<Attachment | null> {
    const rows = await this.db.select().from(attachments).where(eq(attachments.id, id)).limit(1)
    return rows[0] ?? null
  }

  async insert(attachment: Attachment): Promise<void> {
    try {
      await this.db.insert(attachments).values(attachment)
    } catch (error) {
      throw toError(error)
    }
  }

  async update(attachment: Attachment): Promise<void> {
    try {
      const result = await this.db
        .update(attachments)
        .set(attachment)
        .where(eq(attachments.id, attachment.id))
        .returning({ id: attachments.id })
      if (result.length === 0) throw new NotFoundError('attachment')
    } catch (error) {
      throw toError(error)
    }
  }

  /** Oldest-first; id tie-break keeps equal-timestamp rows deterministic. */
  async listByCard(cardId: number): Promise<Attachment[]> {
    return this.db
      .select()
      .from(attachments)
      .where(eq(attachments.cardId, cardId))
      .orderBy(asc(attachments.createdAt), asc(attachments.id))
  }
}
