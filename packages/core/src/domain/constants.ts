/**
 * Domain constants shared by every layer. Lanes/roles/priorities are the seeded
 * vocabulary from docs/product/workflow.md and docs/architecture/data-model.md.
 */

export const LANE_KEYS = [
  'intake',
  'waiting_approval',
  'ready',
  'in_progress',
  'waiting_parts_vendor',
  'review',
  'done',
] as const
export type LaneKey = (typeof LANE_KEYS)[number]

export const ROLES = ['requester', 'technician', 'supervisor', 'admin'] as const
export type Role = (typeof ROLES)[number]

/** True when `role` sits at or above `minimum` in the ordered role ladder (ADR-013). */
export function roleAtLeast(role: Role, minimum: Role): boolean {
  return ROLES.indexOf(role) >= ROLES.indexOf(minimum)
}

export const PRIORITIES = ['P0', 'P1', 'P2'] as const
export type Priority = (typeof PRIORITIES)[number]

/**
 * Card field caps (docs/architecture/data-model.md), owned here as the single
 * source: the zod schemas reference them, and adapters that truncate before
 * validation (Slack thread capture, summarizer clamping) import the same
 * values instead of re-encoding literals.
 */
export const CARD_TITLE_MAX = 200
export const CARD_DESCRIPTION_MAX = 20_000
export const TAG_NAME_MAX = 50

export const WAITING_REASONS = ['parts', 'vendor', 'access', 'info', 'funding'] as const
export type WaitingReason = (typeof WAITING_REASONS)[number]

/** Resolutions clients may set through the explicit cancel action. */
export const CANCEL_RESOLUTIONS = ['cancelled', 'declined', 'duplicate'] as const
export type CancelResolution = (typeof CANCEL_RESOLUTIONS)[number]

/** All terminal resolutions; `completed` is system-set on non-cancel entry into done. */
export const RESOLUTIONS = ['completed', 'cancelled', 'declined', 'duplicate'] as const
export type Resolution = (typeof RESOLUTIONS)[number]

export const CARD_ORIGINS = ['manual', 'slack', 'mcp', 'import', 'pm'] as const
export type CardOrigin = (typeof CARD_ORIGINS)[number]

export const ACTOR_KINDS = ['user', 'mcp', 'slack', 'system'] as const
export type ActorKind = (typeof ACTOR_KINDS)[number]

export const TOKEN_SCOPES = ['read', 'read_write'] as const
export type TokenScope = (typeof TOKEN_SCOPES)[number]

export const LOCATION_KINDS = ['building', 'floor', 'room'] as const
export type LocationKind = (typeof LOCATION_KINDS)[number]

/** Upload caps (docs/architecture/security.md#uploads); enforced by AttachmentService. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
export const MAX_ACTIVE_ATTACHMENTS_PER_CARD = 10

/**
 * MIME allowlist for uploads. Sniffing bytes against it is a server adapter
 * concern (docs/architecture/security.md); the canonical list lives here.
 */
export const ALLOWED_ATTACHMENT_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/heic',
  'application/pdf',
] as const

/**
 * Named always-on rule: the last active admin can never be demoted or
 * deactivated. Enforcement is a user-administration service concern (server
 * side); the rule name lives here so 409 responses cite one canonical id.
 */
export const LAST_ACTIVE_ADMIN_RULE = 'last-active-admin'

/** Staleness defaults for the follow-up feed (docs/architecture/mcp.md `list_stale_cards`). */
export const DEFAULT_REVIEW_STALE_DAYS = 7
export const DEFAULT_BLOCKED_STALE_DAYS = 3

/** Done cards archive this many days after entering Done (docs/product/workflow.md#archival). */
export const DONE_ARCHIVAL_DAYS = 90
