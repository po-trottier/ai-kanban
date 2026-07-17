import {
  ACTOR_KINDS,
  attachmentSchema,
  boardPolicySchema,
  CARD_EVENT_TYPES,
  cardSchema,
  commentSchema,
  laneSchema,
  locationSchema,
  policyActionGatesSchema,
  policyDocumentSchema,
  policyTransitionSchema,
  serviceTokenSchema,
  tagSchema,
  userSchema,
} from '@rivian-kanban/core'
import { z, type ZodType } from 'zod'

/**
 * Response schemas (docs/architecture/rest-api.md#conventions). Entities in
 * core are `strictObject`s (inputs reject unknown keys); responses reuse the
 * same shapes wrapped in plain `z.object` so serialization STRIPS anything
 * not declared — secrets are structurally unable to leak.
 */

export const userResponseSchema = z.object(userSchema.shape)
export const cardResponseSchema = z.object(cardSchema.shape)
export const laneResponseSchema = z.object(laneSchema.shape)
export const locationResponseSchema = z.object(locationSchema.shape)
export const tagResponseSchema = z.object(tagSchema.shape)
export const attachmentResponseSchema = z.object(attachmentSchema.shape)
// Derived from the canonical core shapes (docs/dev/standards.md single-schema
// rule) — only the strictObject wrappers are swapped for stripping z.objects.
export const boardPolicyResponseSchema = z.object({
  ...boardPolicySchema.shape,
  config: z.object({
    ...policyDocumentSchema.shape,
    transitions: z.array(z.object(policyTransitionSchema.shape)),
    actionGates: z.object(policyActionGatesSchema.shape),
  }),
})

/** tokenHash omitted — even its digest never leaves the server. */
export const serviceTokenResponseSchema = z.object(
  serviceTokenSchema.omit({ tokenHash: true }).shape,
)

/** Soft-deleted comment bodies are blanked before serialization. */
export const commentResponseSchema = z.object({ ...commentSchema.shape, body: z.string() })

/** Users for pickers: id, name, role — picked from the core user schema. */
export const pickerUserSchema = z.object(
  userSchema.pick({ id: true, displayName: true, role: true }).shape,
)

/** `{ items, nextCursor | null }` pagination envelope. */
export function pageResponseOf<Item extends ZodType>(item: Item) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() })
}

export const cardDetailResponseSchema = z.object({
  card: cardResponseSchema,
  tags: z.array(tagResponseSchema),
  location: locationResponseSchema.nullable(),
  attachments: z.array(attachmentResponseSchema),
})

export const boardResponseSchema = z.object({
  lanes: z.array(
    z.object({
      lane: laneResponseSchema,
      cards: z.array(cardResponseSchema),
      wipLimitExceeded: z.boolean(),
    }),
  ),
})

/** Card audit events — the payload union is validated at write time (ADR-005). */
export const cardEventResponseSchema = z.object({
  id: z.uuid(),
  cardId: z.uuid(),
  actorId: z.uuid().nullable(),
  actorKind: z.enum(ACTOR_KINDS),
  eventType: z.enum(CARD_EVENT_TYPES),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
})

export const emptyBodySchema = z.null()

/** Headers schema requiring If-Match without stripping other headers. */
export const ifMatchHeadersSchema = z.looseObject({
  'if-match': z.string().min(1),
})

export const idParamsSchema = z.object({ id: z.uuid() })
