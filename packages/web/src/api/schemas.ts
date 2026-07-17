import {
  attachmentSchema,
  cardEventSchema,
  cardSchema,
  commentSchema,
  laneSchema,
  locationSchema,
  policyDocumentSchema,
  serviceTokenSchema,
  tagNameSchema,
  tagSchema,
  userSchema,
} from '@rivian-kanban/core'
import { z, type ZodType } from 'zod'

/**
 * REST response envelopes, composed from the core entity schemas — never
 * redeclared shapes (single-schema rule, docs/dev/standards.md). The envelope
 * layouts mirror docs/architecture/rest-api.md and core's read services.
 */

/** Board card summary: the core card, plus tags when the server includes them. */
const boardCardSchema = cardSchema.extend({
  tags: z.array(tagNameSchema).default([]),
})
export type BoardCard = z.infer<typeof boardCardSchema>

/** `GET /board` — core's `BoardSnapshot` (lanes + cards in position order + WIP state). */
export const boardResponseSchema = z.object({
  lanes: z.array(
    z.object({
      lane: laneSchema,
      cards: z.array(boardCardSchema),
      wipLimitExceeded: z.boolean(),
    }),
  ),
})
export type BoardResponse = z.infer<typeof boardResponseSchema>
export type LaneSnapshot = BoardResponse['lanes'][number]

/** `GET /cards/:id` — core's `CardDetail`. */
export const cardDetailResponseSchema = z.object({
  card: cardSchema,
  tags: z.array(tagSchema),
  location: locationSchema.nullable(),
  attachments: z.array(attachmentSchema),
})
export type CardDetailResponse = z.infer<typeof cardDetailResponseSchema>

/** Cursor pagination envelope `{ items, nextCursor | null }`. */
function pageSchemaOf<T>(item: ZodType<T>) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() })
}

export const cardEventsPageSchema = pageSchemaOf(cardEventSchema)

/** `GET /cards` — the filterable list (`q`, `includeArchived`, …), newest-first. */
export const cardsPageSchema = pageSchemaOf(cardSchema)

/**
 * Comment responses widen the core `body: min(1)`: soft-deleted comments are
 * serialized with a blanked body (rest-api.md#comments — deleted content
 * never leaves the server), and the UI renders the placeholder instead.
 */
export const commentResponseSchema = z.object({ ...commentSchema.shape, body: z.string() })
export const commentsResponseSchema = z.array(commentResponseSchema)
export const attachmentUploadResponseSchema = attachmentSchema

/** `GET /users` — active users (id, name, role) for pickers. */
const pickerUserSchema = userSchema.pick({
  id: true,
  displayName: true,
  role: true,
})
export type PickerUser = z.infer<typeof pickerUserSchema>
export const usersResponseSchema = z.array(pickerUserSchema)

/** `POST /users` / `PATCH /users/:id` — temp password present on create/reset. */
export const adminUserResponseSchema = z.object({
  user: userSchema,
  tempPassword: z.string().optional(),
})

export const meResponseSchema = userSchema
export const loginResponseSchema = userSchema

/**
 * `GET`/`PUT /policy` return the stored policy VERSION record
 * (`{ id, boardId, config, createdBy, createdAt }` — rest-api.md#admin); the
 * app consumes only the document, so the envelope is unwrapped right here.
 */
export const policyResponseSchema = z
  .looseObject({ config: policyDocumentSchema })
  .transform((record) => record.config)

export const locationsResponseSchema = z.array(locationSchema)
export const locationSingleResponseSchema = locationSchema
export const tagsResponseSchema = z.array(tagSchema)

/** Token metadata is serialized without the hash (response-schema serialization). */
const serviceTokenViewSchema = serviceTokenSchema.omit({ tokenHash: true })
export type ServiceTokenView = z.infer<typeof serviceTokenViewSchema>
export const serviceTokensResponseSchema = z.array(serviceTokenViewSchema)

/** `POST /service-tokens` — the raw `rkb_…` credential is returned exactly once. */
export const createdServiceTokenSchema = z.object({
  token: serviceTokenViewSchema,
  rawToken: z.string(),
})
