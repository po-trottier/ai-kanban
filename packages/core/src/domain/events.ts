import { z } from 'zod'
import { ACTOR_KINDS, CANCEL_RESOLUTIONS } from './constants.ts'
import { cardSchema, isoDateTimeSchema, laneKeySchema, tagNameSchema } from './entities.ts'

/**
 * `card_events` audit trail — append-only, written in the same transaction as
 * the mutation it records (ADR-005). Payload shapes are the canonical table in
 * docs/architecture/data-model.md#card_events.
 */

const eventBase = {
  /** UUIDv7 — time-ordered. */
  id: z.uuid(),
  cardId: z.number().int().positive(),
  /** User id or service-token id; null for `system`. */
  actorId: z.uuid().nullable(),
  actorKind: z.enum(ACTOR_KINDS),
  createdAt: isoDateTimeSchema,
}

/** Full card state captured at creation, including initial tags. */
export const cardSnapshotSchema = cardSchema.extend({
  tags: z.array(tagNameSchema),
})
export type CardSnapshot = z.infer<typeof cardSnapshotSchema>

/** Card fields whose edits produce one `card.field_changed` event each. */
export const AUDITED_CARD_FIELDS = [
  'title',
  'description',
  'priority',
  'estimateMinutes',
  'assigneeId',
  'locationId',
  'tags',
  /** Editable in place only while the card sits in the waiting lane. */
  'waitingReason',
  'expectedResumeAt',
] as const
export type AuditedCardField = (typeof AUDITED_CARD_FIELDS)[number]

const fieldValueSchema = z.union([z.string(), z.number(), z.array(tagNameSchema), z.null()])

export const cardEventSchema = z.discriminatedUnion('eventType', [
  z.strictObject({
    ...eventBase,
    eventType: z.literal('card.created'),
    payload: z.strictObject({ snapshot: cardSnapshotSchema }),
  }),
  z.strictObject({
    ...eventBase,
    eventType: z.literal('card.status_changed'),
    payload: z.strictObject({
      fromLane: laneKeySchema,
      toLane: laneKeySchema,
      wipLimitExceeded: z.literal(true).optional(),
      clearedWaiting: z.literal(true).optional(),
    }),
  }),
  z.strictObject({
    ...eventBase,
    eventType: z.literal('card.reordered'),
    payload: z.strictObject({
      lane: laneKeySchema,
      prevCardId: z.number().int().positive().nullable(),
      nextCardId: z.number().int().positive().nullable(),
    }),
  }),
  z.strictObject({
    ...eventBase,
    eventType: z.literal('card.field_changed'),
    payload: z.strictObject({
      field: z.enum(AUDITED_CARD_FIELDS),
      from: fieldValueSchema,
      to: fieldValueSchema,
    }),
  }),
  z.strictObject({
    ...eventBase,
    eventType: z.literal('card.blocked'),
    payload: z.strictObject({ reason: z.string().max(500).optional() }),
  }),
  z.strictObject({
    ...eventBase,
    eventType: z.literal('card.unblocked'),
    payload: z.strictObject({ reason: z.string().max(500).optional() }),
  }),
  z.strictObject({
    ...eventBase,
    eventType: z.literal('card.cancelled'),
    payload: z.strictObject({
      resolution: z.enum(CANCEL_RESOLUTIONS),
      fromLane: laneKeySchema,
    }),
  }),
  z.strictObject({
    ...eventBase,
    eventType: z.literal('card.reopened'),
    payload: z.strictObject({ toLane: laneKeySchema }),
  }),
  z.strictObject({
    ...eventBase,
    eventType: z.literal('card.archived'),
    payload: z.strictObject({}),
  }),
  z.strictObject({
    ...eventBase,
    eventType: z.literal('comment.added'),
    payload: z.strictObject({ commentId: z.uuid(), parentCommentId: z.uuid().optional() }),
  }),
  z.strictObject({
    ...eventBase,
    eventType: z.literal('comment.edited'),
    payload: z.strictObject({ commentId: z.uuid(), parentCommentId: z.uuid().optional() }),
  }),
  z.strictObject({
    ...eventBase,
    eventType: z.literal('comment.deleted'),
    payload: z.strictObject({ commentId: z.uuid(), parentCommentId: z.uuid().optional() }),
  }),
  z.strictObject({
    ...eventBase,
    eventType: z.literal('attachment.added'),
    payload: z.strictObject({ attachmentId: z.uuid(), filename: z.string() }),
  }),
  z.strictObject({
    ...eventBase,
    eventType: z.literal('attachment.removed'),
    payload: z.strictObject({ attachmentId: z.uuid(), filename: z.string() }),
  }),
  z.strictObject({
    ...eventBase,
    eventType: z.literal('card.pii_deleted'),
    payload: z.strictObject({ scope: z.string() }),
  }),
])
export type CardEvent = z.infer<typeof cardEventSchema>

export const CARD_EVENT_TYPES = [
  'card.created',
  'card.status_changed',
  'card.reordered',
  'card.field_changed',
  'card.blocked',
  'card.unblocked',
  'card.cancelled',
  'card.reopened',
  'card.archived',
  'comment.added',
  'comment.edited',
  'comment.deleted',
  'attachment.added',
  'attachment.removed',
  'card.pii_deleted',
] as const
export type CardEventType = (typeof CARD_EVENT_TYPES)[number]
