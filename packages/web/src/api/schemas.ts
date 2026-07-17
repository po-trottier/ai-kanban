import {
  attachmentSchema,
  boardCardSchema,
  boardSnapshotSchemaOf,
  cardDetailSchemaOf,
  cardEventSchema,
  cardSchema,
  laneSchema,
  locationSchema,
  pageSchemaOf,
  pickerUserSchema,
  policyDocumentSchema,
  redactedCommentSchema,
  serviceTokenSchema,
  tagSchema,
  userSchema,
  userWithTempPasswordSchemaOf,
} from '@rivian-kanban/core'
import { z } from 'zod'

/**
 * REST response envelopes, composed from the core entity schemas — never
 * redeclared shapes (single-schema rule, docs/dev/standards.md). The envelope
 * layouts mirror docs/architecture/rest-api.md and core's read services.
 */

/**
 * `GET /board` — core's `BoardSnapshot`: lanes + card SUMMARIES in position
 * order + WIP state (rest-api.md). The board never carries descriptions or
 * Slack bookkeeping; the detail panel fetches `GET /cards/:id`.
 */
export const boardResponseSchema = boardSnapshotSchemaOf({
  lane: laneSchema,
  card: boardCardSchema,
})
export type BoardResponse = z.infer<typeof boardResponseSchema>
export type LaneSnapshot = BoardResponse['lanes'][number]

/** `GET /cards/:id` — core's `CardDetail`. */
export const cardDetailResponseSchema = cardDetailSchemaOf({
  card: cardSchema,
  tag: tagSchema,
  location: locationSchema,
  attachment: attachmentSchema,
})
export type CardDetailResponse = z.infer<typeof cardDetailResponseSchema>

export const cardEventsPageSchema = pageSchemaOf(cardEventSchema)

/** `GET /cards` — the filterable list (`q`, `includeArchived`, …), newest-first. */
export const cardsPageSchema = pageSchemaOf(cardSchema)

/**
 * Comment reads use core's redacted shape: soft-deleted comments arrive with
 * a blanked body (rest-api.md#comments — deleted content never leaves the
 * server), and the UI renders the placeholder instead.
 */
export const commentResponseSchema = z.object(redactedCommentSchema.shape)
export const commentsResponseSchema = z.array(commentResponseSchema)
export const attachmentUploadResponseSchema = attachmentSchema

/** `GET /users` — active users for pickers (core's shared pick roster). */
export const usersResponseSchema = z.array(pickerUserSchema)
export type { PickerUser } from '@rivian-kanban/core'

/** `POST /users` / `PATCH /users/:id` — temp password present on create/reset. */
export const adminUserResponseSchema = userWithTempPasswordSchemaOf(userSchema)

export const meResponseSchema = userSchema
export const loginResponseSchema = userSchema

/** `GET /setup` — whether the first-boot admin account still needs creating. */
export const setupStatusResponseSchema = z.object({ required: z.boolean() })

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
