import {
  ACTOR_KINDS,
  attachmentSchema,
  boardCardSchema,
  boardPolicySchema,
  boardSnapshotSchemaOf,
  CARD_EVENT_TYPES,
  cardDetailSchemaOf,
  cardSchema,
  laneSchema,
  locationSchema,
  pageSchemaOf,
  pickerUserSchema as corePickerUserSchema,
  roleDefinitionSchema,
  policyTransitionSchema,
  redactedCommentSchema,
  serviceTokenSchema,
  tagSchema,
  userSchema,
} from '@rivian-kanban/core'
import { z } from 'zod'

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
// `policyDocumentSchema` carries .refine() effects, so it has no `.shape`; the
// response config is rebuilt field-by-field from the same canonical part
// schemas (single-schema rule) as stripping z.objects.
export const boardPolicyResponseSchema = z.object({
  ...boardPolicySchema.shape,
  config: z.object({
    transitionEnforcement: z.boolean(),
    transitions: z.array(z.object(policyTransitionSchema.shape)),
    roles: z.array(z.object(roleDefinitionSchema.shape)),
  }),
})

/** tokenHash omitted — even its digest never leaves the server. */
export const serviceTokenResponseSchema = z.object(
  serviceTokenSchema.omit({ tokenHash: true }).shape,
)

/** Soft-deleted comment bodies are blanked by core before serialization. */
export const commentResponseSchema = z.object(redactedCommentSchema.shape)

/** Users for pickers — core's shared pick roster, as a stripping wrapper. */
export const pickerUserSchema = z.object(corePickerUserSchema.shape)

/** Core's `{ items, nextCursor | null }` envelope over the stripping wrappers. */
export const pageResponseOf = pageSchemaOf

/** Core's CardDetail envelope, composed from the stripping wrappers above. */
export const cardDetailResponseSchema = cardDetailSchemaOf({
  card: cardResponseSchema,
  tag: tagResponseSchema,
  location: locationResponseSchema,
  attachment: attachmentResponseSchema,
})

/**
 * Core's BoardSnapshot envelope over the board-card SUMMARY (rest-api.md:
 * "non-archived card summaries") — never the full card: the hottest response
 * in the system must not carry 20 KB descriptions for the 90-day done backlog.
 */
export const boardResponseSchema = boardSnapshotSchemaOf({
  lane: laneResponseSchema,
  card: z.object(boardCardSchema.shape),
})

/**
 * Card audit events — the payload union is validated at write time (ADR-005).
 * `actorLabel`/`onBehalfOfUserId` are read-time derivations for mcp actors
 * (service-token name + its creator); the stored `actorId` stays the token id.
 */
export const cardEventResponseSchema = z.object({
  id: z.uuid(),
  cardId: z.number().int().positive(),
  actorId: z.uuid().nullable(),
  actorKind: z.enum(ACTOR_KINDS),
  eventType: z.enum(CARD_EVENT_TYPES),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  actorLabel: z.string().optional(),
  onBehalfOfUserId: z.uuid().optional(),
})

export const emptyBodySchema = z.null()

/** Headers schema requiring If-Match without stripping other headers. */
export const ifMatchHeadersSchema = z.looseObject({
  'if-match': z.string().min(1),
})

export const idParamsSchema = z.object({ id: z.uuid() })

/**
 * Card `:id` path param: the id IS the integer ticket number. URL params arrive
 * as strings, so coerce to a positive int (a non-numeric path 404s at the
 * service). Non-card routes (users, locations, tokens) keep `idParamsSchema`.
 */
export const cardIdParamsSchema = z.object({ id: z.coerce.number().int().positive() })
