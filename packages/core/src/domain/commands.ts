import { z } from 'zod'
import {
  CANCEL_RESOLUTIONS,
  CARD_DESCRIPTION_MAX,
  CARD_TITLE_MAX,
  DEFAULT_THEME,
  DEFAULT_TIMEZONE,
  LOCATION_KINDS,
} from './constants.ts'
import {
  isoDateSchema,
  laneKeySchema,
  prioritySchema,
  roleSchema,
  tagNameSchema,
  themeSchema,
  timezoneSchema,
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
  prevCardId: z.number().int().positive().nullable().default(null),
  nextCardId: z.number().int().positive().nullable().default(null),
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
  /**
   * User ids @-mentioned in the body (docs/architecture/notifications.md). Each
   * is validated + de-duped server-side; a mention notifies + auto-watches that
   * user. The composer sends the ids alongside the `@Name` text it inserted.
   */
  mentions: z.array(z.uuid()).max(50).optional(),
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
  /** A location (building/floor/room); matches the card's own location and, by
   * the query service, every card in that location's subtree. */
  locationId: z.uuid().optional(),
  /** Single tag match, case-insensitive (kept for existing callers e.g. MCP). */
  tag: tagNameSchema.optional(),
  /** Any-of tag match: a card with at least one of these tags (advanced search). */
  tags: z.array(tagNameSchema).max(20).optional(),
  blocked: z.boolean().optional(),
  waitingReason: waitingReasonSchema.optional(),
  overdueResume: z.boolean().optional(),
  /** Title + description substring match, case-insensitive; capped on every surface. */
  q: z.string().max(200).optional(),
  includeArchived: z.boolean().optional(),
  /** Restrict to archived cards only (takes precedence over includeArchived). */
  archivedOnly: z.boolean().optional(),
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
  /** Browser-auto-detected at signup; defaults to PST when the client omits it. */
  timezone: timezoneSchema.default(DEFAULT_TIMEZONE),
  /** Not auto-detected — the browser resolves `system` at render (data-model.md#users). */
  theme: themeSchema.default(DEFAULT_THEME),
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

/** Hard cap on a single async-picker search page (bounds a 10k-user read). */
export const USER_SEARCH_LIMIT_MAX = 50
/** Cap on batch id-resolution — a picker's already-selected set is small. */
export const USER_SEARCH_IDS_MAX = 100

/**
 * The async user-picker query (`GET /users/search`, rest-api.md#auth--users):
 * the scalable replacement for loading every user into the assignee/reporter
 * pickers. Two independent, combinable legs so a 10k-user roster never ships
 * whole:
 *
 * - `q` — case-insensitive substring over display name AND email; empty (the
 *   default) returns the first `limit` users so the picker shows something
 *   before the user types. Bounded by `limit` (default 20, hard cap 50).
 * - `ids` — resolve an explicit, bounded set (≤100) of user ids to their
 *   picker shape, so a card's already-selected assignee/reporter renders
 *   without the full roster. Independent of `q`/`limit`; unknown ids are
 *   simply absent from the result.
 */
export const userSearchQuerySchema = z.strictObject({
  q: z.string().trim().max(200).default(''),
  limit: z.number().int().min(1).max(USER_SEARCH_LIMIT_MAX).default(20),
  ids: z.array(z.uuid()).max(USER_SEARCH_IDS_MAX).optional(),
})
export type UserSearchQuery = z.infer<typeof userSearchQuerySchema>

/**
 * Self-service profile update (`PATCH /auth/me`, rest-api.md#auth--users): the
 * authenticated user editing THEIR OWN display preferences (time zone + theme).
 * Deliberately a strictObject of only those display fields — role, active
 * state, and email stay admin-only, and a strictObject rejects any such extra
 * key at the trust boundary, so this surface can never be used for privilege
 * escalation or mass assignment.
 */
export const updateProfileInputSchema = z.strictObject({
  timezone: timezoneSchema,
  theme: themeSchema,
})
export type UpdateProfileInput = z.infer<typeof updateProfileInputSchema>

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
