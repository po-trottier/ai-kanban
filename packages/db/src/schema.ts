import {
  type ActorKind,
  type CardOrigin,
  type CardEventType,
  type LaneKey,
  type LocationKind,
  type Priority,
  type Resolution,
  type Role,
  type TokenScope,
  type WaitingReason,
} from '@rivian-kanban/core'
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

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  role: text('role').$type<Role>().notNull(),
  passwordHash: text('password_hash').notNull(),
  /** While set, the session may only call change-password. */
  mustChangePassword: integer('must_change_password', { mode: 'boolean' }).notNull().default(false),
  slackUserId: text('slack_user_id'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull(),
  createdAt: text('created_at').notNull(),
})

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
    id: text('id').primaryKey(),
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
    cardId: text('card_id')
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
    cardId: text('card_id')
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
    cardId: text('card_id')
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
    cardId: text('card_id')
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
export const serviceTokens = sqliteTable('service_tokens', {
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
})
