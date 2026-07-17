import { z } from 'zod'
import { CANCEL_RESOLUTIONS } from './constants.ts'
import {
  isoDateSchema,
  laneKeySchema,
  prioritySchema,
  tagNameSchema,
  waitingReasonSchema,
} from './entities.ts'

/**
 * Command input schemas — shared verbatim by REST bodies, MCP tool inputs, and
 * Slack flows (single-schema rule). Strict: unknown keys are rejected
 * (docs/architecture/security.md). `expectedVersion` is the optimistic lock
 * (ADR-012); REST maps it from `If-Match`.
 */

const expectedVersionSchema = z.number().int().min(1)

/**
 * Defaults per the `POST /cards` row in docs/architecture/rest-api.md.
 * Reporter is never client-settable (reporter = acting user); adapters that
 * resolve a different reporter (MCP `reporterEmail`, the seeded system user)
 * pass it through the trusted `CreateCardOptions` service parameter instead.
 */
export const createCardInputSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(20_000).default(''),
  priority: prioritySchema.default('P2'),
  assigneeId: z.uuid().optional(),
  locationId: z.uuid().optional(),
  tags: z.array(tagNameSchema).default([]),
  estimateMinutes: z.number().int().positive().optional(),
})
export type CreateCardInput = z.infer<typeof createCardInputSchema>

/** Field edits; every provided field is diffed into a `card.field_changed` event. */
export const updateCardInputSchema = z.strictObject({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(20_000).optional(),
  priority: prioritySchema.optional(),
  estimateMinutes: z.number().int().positive().nullable().optional(),
  assigneeId: z.uuid().nullable().optional(),
  locationId: z.uuid().nullable().optional(),
  /** Full-replacement semantics (docs/architecture/data-model.md#tags--card_tags). */
  tags: z.array(tagNameSchema).optional(),
  expectedVersion: expectedVersionSchema,
})
export type UpdateCardInput = z.infer<typeof updateCardInputSchema>

/**
 * `toLane` is always required (equal to the current lane for reorders); the
 * server computes the position key from the neighbor ids in-transaction
 * (ADR-006). Waiting-lane fields are required on entry into
 * `waiting_parts_vendor` — validated by CardService because only it knows
 * whether the move is an entry (reorders within the lane don't re-require them).
 */
export const moveCardInputSchema = z.strictObject({
  toLane: laneKeySchema,
  prevCardId: z.uuid().nullable().default(null),
  nextCardId: z.uuid().nullable().default(null),
  waitingReason: waitingReasonSchema.optional(),
  expectedResumeAt: isoDateSchema.optional(),
  expectedVersion: expectedVersionSchema,
})
export type MoveCardInput = z.infer<typeof moveCardInputSchema>

/** Validated by CardService on entry into the waiting lane (always-on data rule). */
export const waitingLaneEntrySchema = z.object({
  waitingReason: waitingReasonSchema,
  expectedResumeAt: isoDateSchema,
})

export const cancelCardInputSchema = z.strictObject({
  resolution: z.enum(CANCEL_RESOLUTIONS),
  expectedVersion: expectedVersionSchema,
})
export type CancelCardInput = z.infer<typeof cancelCardInputSchema>

export const reopenCardInputSchema = z.strictObject({
  expectedVersion: expectedVersionSchema,
})
export type ReopenCardInput = z.infer<typeof reopenCardInputSchema>

export const blockCardInputSchema = z.strictObject({
  reason: z.string().trim().min(1).max(500),
  expectedVersion: expectedVersionSchema,
})
export type BlockCardInput = z.infer<typeof blockCardInputSchema>

export const unblockCardInputSchema = z.strictObject({
  expectedVersion: expectedVersionSchema,
})
export type UnblockCardInput = z.infer<typeof unblockCardInputSchema>

export const addCommentInputSchema = z.strictObject({
  body: z.string().trim().min(1).max(10_000),
  /** Threading: replies to a reply attach to the same parent (one level). */
  parentCommentId: z.uuid().optional(),
})
export type AddCommentInput = z.infer<typeof addCommentInputSchema>

export const editCommentInputSchema = z.strictObject({
  body: z.string().trim().min(1).max(10_000),
})
export type EditCommentInput = z.infer<typeof editCommentInputSchema>

/**
 * Attachment metadata + bytes. The sha256 is computed by the server adapter
 * while streaming the upload (core imports no crypto); MIME sniffing is also a
 * server concern — the allowlist constant lives in core.
 */
export const addAttachmentInputSchema = z.strictObject({
  filename: z.string().trim().min(1).max(255),
  mime: z.string().min(1),
  content: z.instanceof(Uint8Array),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
})
export type AddAttachmentInput = z.infer<typeof addAttachmentInputSchema>

/** `GET /cards` filters (docs/architecture/rest-api.md) — shared by REST and MCP. */
export const listCardsFilterSchema = z.strictObject({
  lane: laneKeySchema.optional(),
  assignee: z.uuid().optional(),
  reporter: z.uuid().optional(),
  priority: prioritySchema.optional(),
  tag: tagNameSchema.optional(),
  blocked: z.boolean().optional(),
  waitingReason: waitingReasonSchema.optional(),
  overdueResume: z.boolean().optional(),
  /** Title + description substring match, case-insensitive. */
  q: z.string().optional(),
  includeArchived: z.boolean().optional(),
})
export type ListCardsFilter = z.infer<typeof listCardsFilterSchema>

/** Cursor pagination envelope: default limit 50, max 200 (400 above). */
export const pageRequestSchema = z.strictObject({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(200).default(50),
})
export type PageRequest = z.infer<typeof pageRequestSchema>
