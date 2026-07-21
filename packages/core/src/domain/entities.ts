import { z } from 'zod'
import {
  ACTOR_KINDS,
  CARD_DESCRIPTION_MAX,
  CARD_ORIGINS,
  CARD_TITLE_MAX,
  LOCATION_KINDS,
  PRIORITIES,
  RESOLUTIONS,
  TAG_NAME_MAX,
  THEMES,
  TOKEN_SCOPES,
  WAITING_REASONS,
} from './constants.ts'

/**
 * Entity schemas mirroring docs/architecture/data-model.md, camelCased.
 * These drive REST/MCP validation, response serialization, and db hydration
 * (single-schema rule, docs/dev/standards.md).
 */

export const isoDateTimeSchema = z.iso.datetime()
/** Date-only `YYYY-MM-DD` (waiting-lane resume dates). */
export const isoDateSchema = z.iso.date()

/**
 * A role KEY, not a fixed enum: roles are data in the active policy document
 * (ADR-013). Shape is validated here; that the key actually EXISTS in the
 * active policy is checked at write time by the admin services and the policy
 * engine (default-deny for an unknown key).
 */
export const roleSchema = z.string().min(1).max(40)
/**
 * A lane KEY, not a fixed enum (like `roleSchema`): lanes are configurable data
 * (admins add/rename/reorder/remove columns). Shape is validated here — a slug
 * of lowercase letters, digits, and underscores; that the key EXISTS on the
 * board is a runtime check (move targets 404 when unknown), not an enum.
 */
export const laneKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, 'lowercase letters, digits, and underscores; must start a letter')
  .max(40)
export const prioritySchema = z.enum(PRIORITIES)
export const waitingReasonSchema = z.enum(WAITING_REASONS)
export const tokenScopeSchema = z.enum(TOKEN_SCOPES)

/** Tag names: ≤ 50 chars, trimmed, case preserved, matched case-insensitively. */
export const tagNameSchema = z.string().trim().min(1).max(TAG_NAME_MAX)

/**
 * An IANA time-zone id (e.g. `America/Los_Angeles`), validated against the
 * runtime's own tz database. Every timestamp the web renders runs through
 * `dayjs.tz(userTimezone)`, which THROWS on an unknown zone — so we reject a
 * bad value at the trust boundary (a hand-crafted API body) rather than let it
 * break every date render for that user.
 */
const SUPPORTED_TIME_ZONES: ReadonlySet<string> = new Set(Intl.supportedValuesOf('timeZone'))
export const timezoneSchema = z
  .string()
  .refine((value) => SUPPORTED_TIME_ZONES.has(value), { message: 'unknown IANA time zone' })

/** The user's display theme; `system` follows the OS/browser color scheme. */
export const themeSchema = z.enum(THEMES)

export const userSchema = z.strictObject({
  id: z.uuid(),
  email: z.email(),
  displayName: z.string().min(1).max(100),
  role: roleSchema,
  mustChangePassword: z.boolean(),
  slackUserId: z.string().nullable(),
  isActive: z.boolean(),
  /** The user's preferred display time zone (data-model.md#users). */
  timezone: timezoneSchema,
  /** The user's preferred display theme (data-model.md#users). */
  theme: themeSchema,
  createdAt: isoDateTimeSchema,
})
export type User = z.infer<typeof userSchema>

export const boardSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1),
  createdAt: isoDateTimeSchema,
})
export type Board = z.infer<typeof boardSchema>

export const laneSchema = z.strictObject({
  id: z.uuid(),
  boardId: z.uuid(),
  key: laneKeySchema,
  label: z.string().min(1).max(50),
  position: z.number().int(),
  wipLimit: z.number().int().positive().nullable(),
})
export type Lane = z.infer<typeof laneSchema>

export const locationSchema = z.strictObject({
  id: z.uuid(),
  parentId: z.uuid().nullable(),
  kind: z.enum(LOCATION_KINDS),
  name: z.string().min(1),
})
export type Location = z.infer<typeof locationSchema>

export const cardSchema = z.strictObject({
  /** The card's primary key IS its human-readable ticket number: a positive
   * integer, unique per board (Jira-style), assigned atomically on create
   * (`MAX(id) + 1` per board). There is no separate UUID. */
  id: z.number().int().positive(),
  boardId: z.uuid(),
  laneId: z.uuid(),
  /** Fractional ordering key, UNIQUE(laneId, position) (ADR-006). */
  position: z.string().min(1),
  title: z.string().min(1).max(CARD_TITLE_MAX),
  description: z.string().max(CARD_DESCRIPTION_MAX),
  priority: prioritySchema,
  estimateMinutes: z.number().int().positive().nullable(),
  reporterId: z.uuid(),
  assigneeId: z.uuid().nullable(),
  locationId: z.uuid().nullable(),
  origin: z.enum(CARD_ORIGINS),
  /** Terminal only; `completed` is system-set, cancel resolutions via the cancel action. */
  resolution: z.enum(RESOLUTIONS).nullable(),
  blocked: z.boolean(),
  blockedReason: z.string().max(500).nullable(),
  blockedAt: isoDateTimeSchema.nullable(),
  waitingReason: waitingReasonSchema.nullable(),
  expectedResumeAt: isoDateSchema.nullable(),
  resumeAlertedAt: isoDateTimeSchema.nullable(),
  /** When the card FIRST entered In Progress — drives the work burn-down bar.
   * Set once on that transition and never cleared by later moves. */
  workStartedAt: isoDateTimeSchema.nullable(),
  slackChannelId: z.string().nullable(),
  slackThreadTs: z.string().nullable(),
  slackPermalink: z.string().nullable(),
  /** Optimistic lock (ADR-012). */
  version: z.number().int().min(1),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  archivedAt: isoDateTimeSchema.nullable(),
})
export type Card = z.infer<typeof cardSchema>

export const tagSchema = z.strictObject({
  id: z.uuid(),
  name: tagNameSchema,
})
export type Tag = z.infer<typeof tagSchema>

export const commentSchema = z.strictObject({
  id: z.uuid(),
  cardId: z.number().int().positive(),
  /** One level of nesting: replies to a reply attach to the same parent. */
  parentCommentId: z.uuid().nullable(),
  authorId: z.uuid(),
  body: z.string().min(1).max(10_000),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  deletedAt: isoDateTimeSchema.nullable(),
})
export type Comment = z.infer<typeof commentSchema>

/**
 * A comment as read back out of a thread: `CommentService.listForCard` blanks
 * soft-deleted bodies (deleted content never leaves the server —
 * docs/architecture/rest-api.md#comments), so every read/response schema
 * widens the stored `body: min(1)` to any string. One declaration keeps REST,
 * MCP, and the web client on the identical shape (single-schema rule).
 */
export const redactedCommentSchema = z.strictObject({ ...commentSchema.shape, body: z.string() })

export const attachmentSchema = z.strictObject({
  id: z.uuid(),
  cardId: z.number().int().positive(),
  /** Original filename, display only — blobs live under `storageKey`. */
  filename: z.string().min(1).max(255),
  mime: z.string().min(1),
  bytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  storageKey: z.uuid(),
  uploadedBy: z.uuid(),
  createdAt: isoDateTimeSchema,
  deletedAt: isoDateTimeSchema.nullable(),
})
export type Attachment = z.infer<typeof attachmentSchema>

export const sessionSchema = z.strictObject({
  /** sha256 hash of the raw cookie id — the raw id never persists (ADR-009). */
  id: z.string().min(1),
  userId: z.uuid(),
  createdAt: isoDateTimeSchema,
  expiresAt: isoDateTimeSchema,
  lastSeenAt: isoDateTimeSchema,
})
export type Session = z.infer<typeof sessionSchema>

export const serviceTokenSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1),
  /** sha256 of the raw `rkb_…` token; raw value is shown once at creation. */
  tokenHash: z.string().min(1),
  role: roleSchema,
  /** Always-on identity rule: `read` tokens cannot call mutating tools. */
  scope: tokenScopeSchema,
  createdBy: z.uuid(),
  createdAt: isoDateTimeSchema,
  lastUsedAt: isoDateTimeSchema.nullable(),
  revokedAt: isoDateTimeSchema.nullable(),
})
export type ServiceToken = z.infer<typeof serviceTokenSchema>

/**
 * Who is acting, from which surface. Constructed by inbound adapters and
 * threaded into every service call so audit events record who did what from
 * where (ADR-004, ADR-005).
 */
export const actorSchema = z.strictObject({
  kind: z.enum(ACTOR_KINDS),
  /**
   * User id for user/slack actors, service-token id for mcp, system user id for
   * system — and for an `agent`, the USER's id (the agent acts as them, so its
   * events attribute to the user and inherit the user's role/permissions).
   */
  id: z.uuid(),
  role: roleSchema,
  /** Present for service-token (`mcp`) and `agent` actors — the read/write grant. */
  scope: tokenScopeSchema.optional(),
  /**
   * `agent` actors only: the OAuth client acting on the user's behalf, so the
   * audit trail can render "Codex on behalf of <user>". `id` is the registered
   * client id; `name` its display label.
   */
  client: z.strictObject({ id: z.string().min(1), name: z.string().min(1) }).optional(),
})
export type Actor = z.infer<typeof actorSchema>
