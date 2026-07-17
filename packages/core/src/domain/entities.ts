import { z } from 'zod'
import {
  ACTOR_KINDS,
  CARD_ORIGINS,
  LANE_KEYS,
  LOCATION_KINDS,
  PRIORITIES,
  RESOLUTIONS,
  ROLES,
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

export const roleSchema = z.enum(ROLES)
export const laneKeySchema = z.enum(LANE_KEYS)
export const prioritySchema = z.enum(PRIORITIES)
export const waitingReasonSchema = z.enum(WAITING_REASONS)
export const tokenScopeSchema = z.enum(TOKEN_SCOPES)

/** Tag names: ≤ 50 chars, trimmed, case preserved, matched case-insensitively. */
export const tagNameSchema = z.string().trim().min(1).max(50)

export const userSchema = z.strictObject({
  id: z.uuid(),
  email: z.email(),
  displayName: z.string().min(1).max(100),
  role: roleSchema,
  mustChangePassword: z.boolean(),
  slackUserId: z.string().nullable(),
  isActive: z.boolean(),
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
  id: z.uuid(),
  boardId: z.uuid(),
  laneId: z.uuid(),
  /** Fractional ordering key, UNIQUE(laneId, position) (ADR-006). */
  position: z.string().min(1),
  title: z.string().min(1).max(200),
  description: z.string().max(20_000),
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
  cardId: z.uuid(),
  /** One level of nesting: replies to a reply attach to the same parent. */
  parentCommentId: z.uuid().nullable(),
  authorId: z.uuid(),
  body: z.string().min(1).max(10_000),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  deletedAt: isoDateTimeSchema.nullable(),
})
export type Comment = z.infer<typeof commentSchema>

export const attachmentSchema = z.strictObject({
  id: z.uuid(),
  cardId: z.uuid(),
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
  /** User id for user/slack actors, service-token id for mcp, system user id for system. */
  id: z.uuid(),
  role: roleSchema,
  /** Present for service-token actors only. */
  scope: tokenScopeSchema.optional(),
})
export type Actor = z.infer<typeof actorSchema>
