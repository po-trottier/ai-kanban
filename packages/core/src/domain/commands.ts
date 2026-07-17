import { z } from 'zod'
import {
  CANCEL_RESOLUTIONS,
  CARD_DESCRIPTION_MAX,
  CARD_TITLE_MAX,
  LOCATION_KINDS,
} from './constants.ts'
import {
  isoDateSchema,
  laneKeySchema,
  prioritySchema,
  roleSchema,
  tagNameSchema,
  tokenScopeSchema,
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
  title: z.string().trim().min(1).max(CARD_TITLE_MAX),
  description: z.string().max(CARD_DESCRIPTION_MAX).default(''),
  priority: prioritySchema.default('P2'),
  assigneeId: z.uuid().optional(),
  locationId: z.uuid().optional(),
  tags: z.array(tagNameSchema).default([]),
  estimateMinutes: z.number().int().positive().optional(),
})
export type CreateCardInput = z.infer<typeof createCardInputSchema>

/** Field edits; every provided field is diffed into a `card.field_changed` event. */
export const updateCardInputSchema = z.strictObject({
  title: z.string().trim().min(1).max(CARD_TITLE_MAX).optional(),
  description: z.string().max(CARD_DESCRIPTION_MAX).optional(),
  priority: prioritySchema.optional(),
  estimateMinutes: z.number().int().positive().nullable().optional(),
  assigneeId: z.uuid().nullable().optional(),
  locationId: z.uuid().nullable().optional(),
  /** Full-replacement semantics (docs/architecture/data-model.md#tags--card_tags). */
  tags: z.array(tagNameSchema).optional(),
  /**
   * In-place edits to the waiting-lane fields (docs/product/workflow.md). Only
   * accepted by CardService.update when the card currently sits in
   * `waiting_parts_vendor` — otherwise a clear 409 conflict. Changing
   * `expectedResumeAt` clears `resume_alerted_at` so the hourly overdue alert
   * re-arms (docs/architecture/data-model.md#resume_alerted_at).
   */
  waitingReason: waitingReasonSchema.optional(),
  expectedResumeAt: isoDateSchema.optional(),
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

/** Manual archive of a Done card (docs/product/workflow.md#archival). */
export const archiveCardInputSchema = z.strictObject({
  expectedVersion: expectedVersionSchema,
})
export type ArchiveCardInput = z.infer<typeof archiveCardInputSchema>

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
  /** A specific location (building/floor/room); matched exactly against the card's own location. */
  locationId: z.uuid().optional(),
  tag: tagNameSchema.optional(),
  blocked: z.boolean().optional(),
  waitingReason: waitingReasonSchema.optional(),
  overdueResume: z.boolean().optional(),
  /** Title + description substring match, case-insensitive; capped on every surface. */
  q: z.string().max(200).optional(),
  includeArchived: z.boolean().optional(),
})
export type ListCardsFilter = z.infer<typeof listCardsFilterSchema>

/** Cursor pagination envelope: default limit 50, max 200 (400 above). */
export const pageRequestSchema = z.strictObject({
  /** Opaque base64url cursor — short by construction; the cap rejects garbage. */
  cursor: z.string().max(500).optional(),
  limit: z.number().int().min(1).max(200).default(50),
})
export type PageRequest = z.infer<typeof pageRequestSchema>

/**
 * Admin command inputs (docs/architecture/rest-api.md#admin). They live here
 * with the card commands so REST bodies and the web forms share one schema
 * (single-schema rule) — the admin services in the server package parse them,
 * the SPA derives its input types from them.
 */

export const createUserInputSchema = z.strictObject({
  email: z.email().max(254),
  displayName: z.string().trim().min(1).max(100),
  role: roleSchema,
})
export type CreateUserInput = z.infer<typeof createUserInputSchema>

/**
 * First-boot setup input (`POST /setup`, rest-api.md#auth--users): creates
 * the initial admin while zero non-system users exist. Email/name reuse the
 * create-user shapes; the password only gets a transport bound here — the
 * real policy (12–128 chars + common-password reject) is enforced by the
 * server's password-policy module, same as change-password.
 */
export const setupAdminInputSchema = z.strictObject({
  email: createUserInputSchema.shape.email,
  displayName: createUserInputSchema.shape.displayName,
  password: z.string().min(1).max(1024),
})
export type SetupAdminInput = z.infer<typeof setupAdminInputSchema>

export const updateUserInputSchema = z
  .strictObject({
    displayName: z.string().trim().min(1).max(100).optional(),
    role: roleSchema.optional(),
    isActive: z.boolean().optional(),
    /** Issues a fresh one-time temp password (shown once in the response). */
    resetPassword: z.literal(true).optional(),
  })
  .refine((input) => Object.keys(input).length > 0, { message: 'no fields to update' })
export type UpdateUserInput = z.infer<typeof updateUserInputSchema>

/** Label and WIP limit only — lane keys/positions are structural (seeded). */
export const updateLaneInputSchema = z
  .strictObject({
    label: z.string().trim().min(1).max(50).optional(),
    /** null clears the WIP limit. */
    wipLimit: z.number().int().positive().nullable().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, {
    message: 'at least one of label or wipLimit is required',
  })
export type UpdateLaneInput = z.infer<typeof updateLaneInputSchema>

export const createLocationInputSchema = z.strictObject({
  parentId: z.uuid().nullable().default(null),
  kind: z.enum(LOCATION_KINDS),
  name: z.string().trim().min(1).max(100),
})
export type CreateLocationInput = z.infer<typeof createLocationInputSchema>

export const updateLocationInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
})
export type UpdateLocationInput = z.infer<typeof updateLocationInputSchema>

export const createServiceTokenInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  role: roleSchema,
  scope: tokenScopeSchema,
})
export type CreateServiceTokenInput = z.infer<typeof createServiceTokenInputSchema>
