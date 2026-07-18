import {
  DEFAULT_THEME,
  DEFAULT_TIMEZONE,
  type ActorKind,
  type CardOrigin,
  type CardEventType,
  type LaneKey,
  type LocationKind,
  type Priority,
  type Resolution,
  type Role,
  type Theme,
  type TokenScope,
  type WaitingReason,
} from '@rivian-kanban/core'
import { sql } from 'drizzle-orm'
import {
  customType,
  index,
  integer,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  type AnySQLiteColumn,
  sqliteTable,
} from 'drizzle-orm/sqlite-core'

/**
 * Drizzle schema mirroring docs/architecture/data-model.md exactly.
 *
 * Portability rules (ADR-003, enforced): conservative column types only —
 * TEXT / INTEGER / REAL, ISO-8601 UTC TEXT timestamps, TEXT UUIDv7 ids. The
 * Postgres port is a mechanical `sqlite-core` → `pg-core` rewrite behind
 * unchanged repository ports. Property names are the camelCase entity fields;
 * column names are the documented snake_case — the mapping lives here and
 * nowhere else.
 */

/**
 * TEXT with case-insensitive (ASCII) collation. `COLLATE NOCASE` is a column
 * constraint, so SQLite parses the type-name as plain TEXT; the Postgres
 * rewrite maps this to CITEXT or a lower() unique index.
 */
const nocaseText = customType<{ data: string }>({
  dataType: () => 'text COLLATE NOCASE',
})

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    /** Stored lowercased (data-model.md); see the lower() unique index below. */
    email: text('email').notNull().unique(),
    displayName: text('display_name').notNull(),
    role: text('role').$type<Role>().notNull(),
    passwordHash: text('password_hash').notNull(),
    /** While set, the session may only call change-password. */
    mustChangePassword: integer('must_change_password', { mode: 'boolean' })
      .notNull()
      .default(false),
    slackUserId: text('slack_user_id'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull(),
    /** IANA display time zone; defaults to PST so existing rows backfill on migration. */
    timezone: text('timezone').notNull().default(DEFAULT_TIMEZONE),
    /** Display theme; defaults to `system` so existing rows backfill on migration. */
    theme: text('theme').$type<Theme>().notNull().default(DEFAULT_THEME),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    /**
     * Every email lookup is case-insensitive (`lower(email) = lower(?)`), so
     * the database must enforce case-insensitive uniqueness too — otherwise a
     * stray mixed-case insert would make login lookups ambiguous. Maps to a
     * CITEXT/lower() unique index on the Postgres port (ADR-003).
     */
    uniqueIndex('users_email_ci_unique').on(sql`lower(${table.email})`),
    /**
     * Backs the async user-picker read (`GET /users/search`), which the
     * assignee/reporter pickers use so a 10k+ roster never loads whole. The
     * query orders by `lower(display_name)`; this lets SQLite serve the
     * ordered, capped page from the index instead of sorting the whole table,
     * and covers a name-prefix `LIKE` (substring `%…%` still scans, but the
     * `limit` bounds the read either way).
     */
    index('users_display_name_ci_idx').on(sql`lower(${table.displayName})`),
  ],
)

/** Single seeded row in v1; cards reference it so multi-board is additive later. */
export const boards = sqliteTable('boards', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull(),
})

export const lanes = sqliteTable(
  'lanes',
  {
    id: text('id').primaryKey(),
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id),
    /** Stable machine key; labels are editable, keys never are. */
    key: text('key').$type<LaneKey>().notNull(),
    label: text('label').notNull(),
    position: integer('position').notNull(),
    wipLimit: integer('wip_limit'),
  },
  (table) => [unique('lanes_board_id_key_unique').on(table.boardId, table.key)],
)

/** Optional tree: buildings > floors > rooms. Seeded, admin-editable. */
export const locations = sqliteTable('locations', {
  id: text('id').primaryKey(),
  parentId: text('parent_id').references((): AnySQLiteColumn => locations.id),
  kind: text('kind').$type<LocationKind>().notNull(),
  name: text('name').notNull(),
})

/** Append-only policy versions — newest row per board wins (ADR-013). */
export const boardPolicies = sqliteTable(
  'board_policies',
  {
    id: text('id').primaryKey(),
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id),
    /** Zod-validated PolicyDocument JSON (schema in ADR-013). */
    config: text('config', { mode: 'json' }).notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('board_policies_board_id_created_at_idx').on(table.boardId, table.createdAt)],
)

export const cards = sqliteTable(
  'cards',
  {
    /** The primary key IS the human-readable ticket number: a per-board
     * sequential integer assigned by the service (MAX(id)+1), not autoincrement.
     * Globally unique as the PK; per-board sequential by construction. */
    id: integer('id').primaryKey(),
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id),
    laneId: text('lane_id')
      .notNull()
      .references(() => lanes.id),
    /** Base-62 fractional ordering key (ADR-006). */
    position: text('position').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    priority: text('priority').$type<Priority>().notNull(),
    estimateMinutes: integer('estimate_minutes'),
    reporterId: text('reporter_id')
      .notNull()
      .references(() => users.id),
    assigneeId: text('assignee_id').references(() => users.id),
    locationId: text('location_id').references(() => locations.id),
    origin: text('origin').$type<CardOrigin>().notNull(),
    /** Terminal only; `completed` is system-set, cancel resolutions via the cancel action. */
    resolution: text('resolution').$type<Resolution>(),
    blocked: integer('blocked', { mode: 'boolean' }).notNull().default(false),
    blockedReason: text('blocked_reason'),
    blockedAt: text('blocked_at'),
    /** Required in the waiting lane; cleared on lane exit. */
    waitingReason: text('waiting_reason').$type<WaitingReason>(),
    /** Date-only YYYY-MM-DD; overdue = the following UTC day onward. */
    expectedResumeAt: text('expected_resume_at'),
    /** Set when the overdue DM fires; cleared on lane exit (one alert per episode). */
    resumeAlertedAt: text('resume_alerted_at'),
    /** First entry into In Progress (drives the work burn-down bar); set once. */
    workStartedAt: text('work_started_at'),
    slackChannelId: text('slack_channel_id'),
    slackThreadTs: text('slack_thread_ts'),
    slackPermalink: text('slack_permalink'),
    /** Optimistic lock (ADR-012). */
    version: integer('version').notNull().default(1),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    archivedAt: text('archived_at'),
  },
  (table) => [
    /** The concurrent-duplicate backstop (ADR-006) → DuplicatePositionError. */
    uniqueIndex('cards_lane_id_position_unique').on(table.laneId, table.position),
    index('cards_board_id_archived_at_idx').on(table.boardId, table.archivedAt),
    index('cards_assignee_id_idx').on(table.assigneeId),
    index('cards_reporter_id_idx').on(table.reporterId),
    /**
     * Supports the keyset list query (`ORDER BY created_at DESC, id DESC`
     * with a `(created_at, id) <` cursor) — SQLite walks the ASC index
     * backwards, so every page is O(page) instead of a full scan + sort.
     */
    index('cards_created_at_id_idx').on(table.createdAt, table.id),
    /**
     * Partial index for the hottest read: `listByLane(…, { activeOnly })`
     * (board snapshot per mutation, WIP counts, archival candidates). Done
     * cards are archived in place, so the done lane accumulates every
     * completed card forever — without this, each activeOnly read walks the
     * whole lifetime archive under the UNIQUE index just to reject it. The
     * UNIQUE index above still serves the duplicate-position backstop,
     * edgeOfLane, and full-lane reads.
     */
    index('cards_lane_active_position_idx')
      .on(table.laneId, table.position)
      .where(sql`${table.archivedAt} is null`),
    /**
     * Partial index for the stale-cards blocked leg (`blocked AND archived_at
     * IS NULL ORDER BY created_at DESC, id DESC`): the query predicate
     * subsumes the index predicate, so the scan visits only live blocked
     * cards instead of every card ever created.
     */
    index('cards_blocked_active_idx')
      .on(table.createdAt, table.id)
      .where(sql`${table.blocked} = 1 and ${table.archivedAt} is null`),
  ],
)

/** Free-form tags, created on first use, matched case-insensitively. */
export const tags = sqliteTable('tags', {
  id: text('id').primaryKey(),
  name: nocaseText('name').notNull().unique(),
})

export const cardTags = sqliteTable(
  'card_tags',
  {
    cardId: integer('card_id')
      .notNull()
      .references(() => cards.id),
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id),
  },
  (table) => [primaryKey({ columns: [table.cardId, table.tagId] })],
)

export const comments = sqliteTable(
  'comments',
  {
    id: text('id').primaryKey(),
    cardId: integer('card_id')
      .notNull()
      .references(() => cards.id),
    /** One level of nesting: replies to a reply attach to the same parent. */
    parentCommentId: text('parent_comment_id').references((): AnySQLiteColumn => comments.id),
    authorId: text('author_id')
      .notNull()
      .references(() => users.id),
    body: text('body').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    /** Soft delete keeps thread shape; body rendered as "deleted". */
    deletedAt: text('deleted_at'),
  },
  (table) => [index('comments_card_id_created_at_idx').on(table.cardId, table.createdAt)],
)

/** Metadata only — binaries live behind the BlobStorePort, never in the database. */
export const attachments = sqliteTable(
  'attachments',
  {
    id: text('id').primaryKey(),
    cardId: integer('card_id')
      .notNull()
      .references(() => cards.id),
    /** Original filename, display only. */
    filename: text('filename').notNull(),
    mime: text('mime').notNull(),
    bytes: integer('bytes').notNull(),
    sha256: text('sha256').notNull(),
    /** The blob's server-generated name on disk/S3. */
    storageKey: text('storage_key').notNull(),
    uploadedBy: text('uploaded_by')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
    deletedAt: text('deleted_at'),
  },
  (table) => [index('attachments_card_id_idx').on(table.cardId)],
)

/** The audit trail: append-only, never updated or deleted (ADR-005). */
export const cardEvents = sqliteTable(
  'card_events',
  {
    /** UUIDv7 — time-ordered. */
    id: text('id').primaryKey(),
    cardId: integer('card_id')
      .notNull()
      .references(() => cards.id),
    /** User id or service-token id — deliberately no FK; NULL for `system`. */
    actorId: text('actor_id'),
    actorKind: text('actor_kind').$type<ActorKind>().notNull(),
    eventType: text('event_type').$type<CardEventType>().notNull(),
    /** JSON, shape per event type (data-model.md#card_events). */
    payload: text('payload', { mode: 'json' }).notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('card_events_card_id_created_at_idx').on(table.cardId, table.createdAt)],
)

/** Server-side web sessions (ADR-009); id is the sha256 of the raw cookie id. */
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  createdAt: text('created_at').notNull(),
  expiresAt: text('expires_at').notNull(),
  lastSeenAt: text('last_seen_at').notNull(),
})

/** MCP/automation credentials; revocation is the only lifecycle end (ADR-009). */
export const serviceTokens = sqliteTable(
  'service_tokens',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    /** sha256 of the raw `rkb_…` token; the raw value is shown once at creation. */
    tokenHash: text('token_hash').notNull(),
    role: text('role').$type<Role>().notNull(),
    /** Always-on identity rule: `read` tokens cannot call mutating tools. */
    scope: text('scope').$type<TokenScope>().notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
    lastUsedAt: text('last_used_at'),
    revokedAt: text('revoked_at'),
  },
  (table) => [
    /**
     * Credential-hash uniqueness is an integrity invariant the schema owns
     * (like users_email_ci_unique): rows are never deleted, and two rows
     * sharing a hash would make bearer auth resolve an arbitrary one. Also
     * the index behind the per-request findByHash lookup.
     */
    uniqueIndex('service_tokens_token_hash_unique').on(table.tokenHash),
  ],
)

/** Per-user saved board filters (docs/architecture/board-filters.md). */
export const filterPresets = sqliteTable(
  'filter_presets',
  {
    id: text('id').primaryKey(),
    /** The only user who can see or edit the preset (per-user private). */
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    /** Zod-validated BoardFilter JSON (boardFilterSchema). */
    filter: text('filter', { mode: 'json' }).notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  // The per-owner newest-first list (`WHERE owner_id = ? ORDER BY created_at
  // DESC, id DESC`) — the only query surface.
  (table) => [index('filter_presets_owner_id_created_at_idx').on(table.ownerId, table.createdAt)],
)
