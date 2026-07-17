import { addAttachmentInputSchema } from '../domain/commands.ts'
import { MAX_ACTIVE_ATTACHMENTS_PER_CARD, MAX_ATTACHMENT_BYTES } from '../domain/constants.ts'
import { LimitExceededError, NotFoundError } from '../domain/errors.ts'
import { type Actor, type Attachment } from '../domain/entities.ts'
import { evaluatePolicy } from '../policy/policy-engine.ts'
import { type UnitOfWork } from '../ports/repositories.ts'
import {
  type BlobStorePort,
  type Clock,
  type EventBus,
  type IdGenerator,
} from '../ports/runtime.ts'
import {
  activePolicy,
  decide,
  ensureNotArchived,
  makeEvent,
  publishCardHints,
  requireFound,
} from './internal.ts'

export interface AttachmentServiceDeps {
  uow: UnitOfWork
  clock: Clock
  ids: IdGenerator
  eventBus: EventBus
  blobStore: BlobStorePort
}

/**
 * Attachment metadata + blob storage. Blobs live behind BlobStorePort under
 * random storage keys; MIME sniffing is a server adapter concern (the
 * allowlist constant lives in core constants).
 */
export class AttachmentService {
  private readonly deps: AttachmentServiceDeps

  constructor(deps: AttachmentServiceDeps) {
    this.deps = deps
  }

  /**
   * Stores the blob, then inserts metadata; the 10-active-files cap is
   * enforced inside the insert transaction. A failed insert cleans the blob
   * up best-effort — a cleanup failure never masks the domain error.
   *
   * Policy checks: `attachment.add` (read-scope tokens denied); archived
   * cards read-only (409); the actor must resolve to a real user
   * (`attachments.uploaded_by` is a users FK — no MCP upload flow exists in v1).
   * Caps: 25 MB/file, 10 active files/card (409).
   * Audit events: `attachment.added`.
   */
  async add(actor: Actor, cardId: string, rawInput: unknown): Promise<Attachment> {
    const input = addAttachmentInputSchema.parse(rawInput)
    if (input.content.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new LimitExceededError('attachment exceeds the 25 MB limit', MAX_ATTACHMENT_BYTES)
    }
    const storageKey = this.deps.ids.newId()
    await this.deps.blobStore.put(storageKey, input.content)
    try {
      const { attachment, card, event } = await this.deps.uow.run(async (tx) => {
        const targetCard = requireFound(await tx.cards.findById(cardId), 'card')
        ensureNotArchived(targetCard)
        const policy = await activePolicy(tx, targetCard.boardId)
        decide(evaluatePolicy(actor, { type: 'attachment.add' }, policy))
        requireFound(await tx.users.findById(actor.id), 'uploader')

        const active = (await tx.attachments.listByCard(targetCard.id)).filter(
          (existing) => existing.deletedAt === null,
        )
        if (active.length >= MAX_ACTIVE_ATTACHMENTS_PER_CARD) {
          throw new LimitExceededError(
            'card already has the maximum number of active attachments',
            MAX_ACTIVE_ATTACHMENTS_PER_CARD,
          )
        }

        const created: Attachment = {
          id: this.deps.ids.newId(),
          cardId: targetCard.id,
          filename: input.filename,
          mime: input.mime,
          bytes: input.content.byteLength,
          sha256: input.sha256,
          storageKey,
          uploadedBy: actor.id,
          createdAt: this.deps.clock.now().toISOString(),
          deletedAt: null,
        }
        await tx.attachments.insert(created)
        const added = makeEvent(this.deps.ids, this.deps.clock, actor, targetCard.id, {
          eventType: 'attachment.added',
          payload: { attachmentId: created.id, filename: created.filename },
        })
        await tx.events.append(added)
        return { attachment: created, card: targetCard, event: added }
      })
      publishCardHints(this.deps.eventBus, card, [event])
      return attachment
    } catch (error) {
      try {
        await this.deps.blobStore.delete(storageKey)
      } catch {
        // Best-effort cleanup: the store just failed or is unreachable — the
        // original domain error must propagate, not this rejection.
      }
      throw error
    }
  }

  /**
   * Soft-deletes the metadata row, hints connected clients, then removes the
   * blob best-effort — once the row is committed, a blob-store failure must
   * not report the delete as failed or suppress the SSE hint (an orphaned
   * blob is strictly better than a lost invalidation).
   *
   * Policy checks: uploader always may; others require the
   * `deleteOthersAttachments` action gate. Archived cards read-only.
   * Audit events: `attachment.removed`.
   */
  async remove(actor: Actor, attachmentId: string): Promise<Attachment> {
    const { attachment, card, event } = await this.deps.uow.run(async (tx) => {
      const existing = requireFound(await tx.attachments.findById(attachmentId), 'attachment')
      if (existing.deletedAt !== null) throw new NotFoundError('attachment')
      const targetCard = requireFound(await tx.cards.findById(existing.cardId), 'card')
      ensureNotArchived(targetCard)
      const policy = await activePolicy(tx, targetCard.boardId)
      decide(
        evaluatePolicy(
          actor,
          { type: 'attachment.remove', uploaderId: existing.uploadedBy },
          policy,
        ),
      )

      const updated: Attachment = {
        ...existing,
        deletedAt: this.deps.clock.now().toISOString(),
      }
      await tx.attachments.update(updated)
      const removed = makeEvent(this.deps.ids, this.deps.clock, actor, targetCard.id, {
        eventType: 'attachment.removed',
        payload: { attachmentId: updated.id, filename: updated.filename },
      })
      await tx.events.append(removed)
      return { attachment: updated, card: targetCard, event: removed }
    })
    publishCardHints(this.deps.eventBus, card, [event])
    try {
      await this.deps.blobStore.delete(attachment.storageKey)
    } catch {
      // Best-effort: the row is already soft-deleted and hinted.
    }
    return attachment
  }
}
