import {
  attachmentSchema,
  boardCardSchema,
  boardSnapshotSchemaOf,
  cardDetailSchemaOf,
  cardEventSchema,
  cardRelationViewSchema,
  cardSchema,
  filterPresetSchema,
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

/**
 * Card events carry read-time attribution for mcp actors: `actorLabel` (the
 * service-token name) and `onBehalfOfUserId` (its creator), derived by the
 * server (rest-api.md). The stored event never has them, so they are optional;
 * the intersection keeps core's discriminated payload union intact.
 */
const cardEventResponseSchema = z.intersection(
  cardEventSchema,
  z.object({
    actorLabel: z.string().optional(),
    onBehalfOfUserId: z.uuid().optional(),
  }),
)
export type CardEventResponse = z.infer<typeof cardEventResponseSchema>
export const cardEventsPageSchema = pageSchemaOf(cardEventResponseSchema)

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

/** `GET /filter-presets` — the caller's saved board filters (core's stored shape). */
export const filterPresetResponseSchema = filterPresetSchema
export const filterPresetsResponseSchema = z.array(filterPresetSchema)

/** `GET`/`POST /cards/:id/relations` — a relation resolved to the other card. */
export const cardRelationResponseSchema = cardRelationViewSchema
export const cardRelationsResponseSchema = z.array(cardRelationViewSchema)

/**
 * `GET /cards?q=` for the relation-target picker: only the id + title are read,
 * so the page items are parsed leanly (extra card fields are stripped). Uses the
 * same `pageSchemaOf` envelope the server serializes, so the shape can't drift.
 */
const cardSearchItemSchema = z.object({ id: z.number().int().positive(), title: z.string() })
export type CardSearchItem = z.infer<typeof cardSearchItemSchema>
export const cardSearchResponseSchema = pageSchemaOf(cardSearchItemSchema)
