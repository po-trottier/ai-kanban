import { addCommentInputSchema, editCommentInputSchema } from '../domain/commands.ts'
import { NotFoundError } from '../domain/errors.ts'
import { type Actor, type Card, type Comment } from '../domain/entities.ts'
import { type CardEvent } from '../domain/events.ts'
import { evaluatePolicy } from '../policy/policy-engine.ts'
import { type TransactionContext, type UnitOfWork } from '../ports/repositories.ts'
import { type Clock, type EventBus, type IdGenerator } from '../ports/runtime.ts'
import {
  activePolicy,
  decide,
  ensureNotArchived,
  makeEvent,
  publishCardHints,
  redactDeletedComments,
  requireFound,
} from './internal.ts'

export interface CommentServiceDeps {
  uow: UnitOfWork
  clock: Clock
  ids: IdGenerator
  eventBus: EventBus
}

/**
 * Trusted, adapter-only comment context — never part of the client-parseable
 * schema. `comments.author_id` is an FK to users (data-model.md), so the MCP
 * adapter must pass a resolved user (the seeded system user): a service-token
 * id is not a user id. The audit event keeps the token identity regardless.
 */
export interface AddCommentOptions {
  /** Resolved author user id; defaults to the acting user. */
  authorId?: string
}

/**
 * Threaded comments (one level: replies to a reply attach to the same
 * parent). Soft deletes keep thread shape. All mutations write their audit
 * event in the same transaction and hint the EventBus after commit.
 */
export class CommentService {
  private readonly deps: CommentServiceDeps

  constructor(deps: CommentServiceDeps) {
    this.deps = deps
  }

  /**
   * Adds a comment (optionally as a reply — replies to a reply re-attach to
   * the top-level parent per data-model.md). The author is the acting user
   * unless a trusted adapter passed a resolved `options.authorId`; either way
   * it must resolve to a real user (`comments.author_id` is a users FK).
   *
   * Policy checks: `comment.add` (read-scope tokens denied); archived cards
   * are read-only (409).
   * Audit events: `comment.added` with commentId + parentCommentId.
   */
  async add(
    actor: Actor,
    cardId: number,
    rawInput: unknown,
    options: AddCommentOptions = {},
  ): Promise<Comment> {
    const input = addCommentInputSchema.parse(rawInput)
    const { comment, card, event } = await this.deps.uow.run(async (tx) => {
      const targetCard = requireFound(await tx.cards.findById(cardId), 'card')
      ensureNotArchived(targetCard)
      const policy = await activePolicy(tx, targetCard.boardId)
      decide(evaluatePolicy(actor, { type: 'comment.add' }, policy))
      const authorId = options.authorId ?? actor.id
      requireFound(await tx.users.findById(authorId), 'author')

      let parentCommentId: string | null = null
      if (input.parentCommentId !== undefined) {
        const parent = await tx.comments.findById(input.parentCommentId)
        if (parent?.cardId !== targetCard.id) {
          throw new NotFoundError('parent comment')
        }
        parentCommentId = parent.parentCommentId ?? parent.id
      }

      const nowIso = this.deps.clock.now().toISOString()
      const created: Comment = {
        id: this.deps.ids.newId(),
        cardId: targetCard.id,
        parentCommentId,
        authorId,
        body: input.body,
        createdAt: nowIso,
        updatedAt: nowIso,
        deletedAt: null,
      }
      await tx.comments.insert(created)

      // @-mentions (docs/architecture/notifications.md): each mentioned user
      // (de-duped, must exist, never the author themselves) is auto-watched and
      // gets a dedicated `mention` notification. Their ids ride on the event so
      // the general watcher fan-out skips them (no duplicate comment notice).
      const mentionedUserIds = await this.resolveMentions(
        tx,
        input.mentions ?? [],
        authorId,
        targetCard.id,
        nowIso,
      )
      const added = await this.appendCommentEvent(tx, actor, targetCard, 'comment.added', created, {
        mentionedUserIds,
      })
      return { comment: created, card: targetCard, event: added }
    })
    publishCardHints(this.deps.eventBus, card, [event])
    return comment
  }

  /**
   * Resolves the @-mention ids to real users (skipping the author + unknown
   * ids), auto-watches each, and writes their `mention` notification. Returns
   * the resolved recipient ids so the caller can stamp them on the event.
   */
  private async resolveMentions(
    tx: TransactionContext,
    rawMentions: readonly string[],
    authorId: string,
    cardId: number,
    nowIso: string,
  ): Promise<string[]> {
    const resolved: string[] = []
    for (const userId of new Set(rawMentions)) {
      if (userId === authorId) continue
      const user = await tx.users.findById(userId)
      if (user === null) continue
      resolved.push(userId)
      await tx.cardWatchers.add(cardId, userId, nowIso)
      await tx.notifications.insert({
        id: this.deps.ids.newId(),
        userId,
        cardId,
        actorId: authorId,
        eventType: 'mention',
        createdAt: nowIso,
        readAt: null,
      })
    }
    return resolved
  }

  /**
   * Edits a comment body — author-only, always (impersonation prevention).
   *
   * Policy checks: `comment.edit` identity rule; archived cards read-only.
   * Audit events: `comment.edited`.
   */
  async edit(actor: Actor, commentId: string, rawInput: unknown): Promise<Comment> {
    const input = editCommentInputSchema.parse(rawInput)
    const { comment, card, event } = await this.deps.uow.run(async (tx) => {
      const existing = await this.requireActiveComment(tx, commentId)
      const targetCard = requireFound(await tx.cards.findById(existing.cardId), 'card')
      ensureNotArchived(targetCard)
      const policy = await activePolicy(tx, targetCard.boardId)
      decide(evaluatePolicy(actor, { type: 'comment.edit', authorId: existing.authorId }, policy))

      const updated: Comment = {
        ...existing,
        body: input.body,
        updatedAt: this.deps.clock.now().toISOString(),
      }
      await tx.comments.update(updated)
      const edited = await this.appendCommentEvent(tx, actor, targetCard, 'comment.edited', updated)
      return { comment: updated, card: targetCard, event: edited }
    })
    publishCardHints(this.deps.eventBus, card, [event])
    return comment
  }

  /**
   * Soft-deletes a comment, keeping thread shape (body renders as "deleted").
   *
   * Policy checks: author always may; others require the
   * `deleteOthersComments` action gate (absent = any authenticated user).
   * Archived cards read-only.
   * Audit events: `comment.deleted`.
   */
  async softDelete(actor: Actor, commentId: string): Promise<Comment> {
    const { comment, card, event } = await this.deps.uow.run(async (tx) => {
      const existing = await this.requireActiveComment(tx, commentId)
      const targetCard = requireFound(await tx.cards.findById(existing.cardId), 'card')
      ensureNotArchived(targetCard)
      const policy = await activePolicy(tx, targetCard.boardId)
      decide(evaluatePolicy(actor, { type: 'comment.delete', authorId: existing.authorId }, policy))

      const nowIso = this.deps.clock.now().toISOString()
      const updated: Comment = { ...existing, deletedAt: nowIso, updatedAt: nowIso }
      await tx.comments.update(updated)
      const deleted = await this.appendCommentEvent(
        tx,
        actor,
        targetCard,
        'comment.deleted',
        updated,
      )
      return { comment: updated, card: targetCard, event: deleted }
    })
    publishCardHints(this.deps.eventBus, card, [event])
    return comment
  }

  /**
   * The full thread for a card, oldest-first. Soft-deleted comments keep
   * their place (thread shape) but their body is blanked here, in the one
   * shared read path — deleted content never leaves the server on ANY
   * surface (rest-api.md#comments, `redactedCommentSchema`).
   */
  async listForCard(cardId: number): Promise<Comment[]> {
    const thread = await this.deps.uow.read(async (tx) => {
      requireFound(await tx.cards.findById(cardId), 'card')
      return tx.comments.listByCard(cardId)
    })
    return redactDeletedComments(thread)
  }

  private async requireActiveComment(tx: TransactionContext, commentId: string): Promise<Comment> {
    const comment = requireFound(await tx.comments.findById(commentId), 'comment')
    if (comment.deletedAt !== null) throw new NotFoundError('comment')
    return comment
  }

  private async appendCommentEvent(
    tx: TransactionContext,
    actor: Actor,
    card: Card,
    eventType: 'comment.added' | 'comment.edited' | 'comment.deleted',
    comment: Comment,
    extra: { mentionedUserIds?: string[] } = {},
  ): Promise<CardEvent> {
    const event = makeEvent(this.deps.ids, this.deps.clock, actor, card.id, {
      eventType,
      payload: {
        commentId: comment.id,
        ...(comment.parentCommentId !== null ? { parentCommentId: comment.parentCommentId } : {}),
        // Only comment.added carries mentions; the field is absent otherwise.
        ...(extra.mentionedUserIds !== undefined && extra.mentionedUserIds.length > 0
          ? { mentionedUserIds: extra.mentionedUserIds }
          : {}),
      },
    })
    await tx.events.append(event)
    return event
  }
}
