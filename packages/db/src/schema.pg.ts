import {
  DEFAULT_THEME,
  DEFAULT_TIMEZONE,
  type ActorKind,
  type CardEventType,
  type CardOrigin,
  type LaneKey,
  type LocationKind,
  type NotificationKind,
  type Priority,
  type RelationType,
  type Resolution,
  type Role,
  type Theme,
  type TokenScope,
  type WaitingReason,
} from '@rivian-kanban/core'
import { sql } from 'drizzle-orm'
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'

/**
 * TEXT with byte-wise (`C`) collation. SQLite compares TEXT byte-wise by
 * default; a production Postgres usually defaults to a locale collation, which
 * would reorder the base-62 fractional position keys (mixed case). Pinning the
 * column to `COLLATE "C"` keeps `ORDER BY position` byte-wise on any Postgres,
 * preserving the ADR-006 fractional-ordering contract.
 */
const byteText = customType<{ data: string }>({
  dataType: () => 'text COLLATE "C"',
})

/**
 * The PostgreSQL mirror of `schema.ts` (ADR-020) — the mechanical
 * `sqlite-core` → `pg-core` rewrite the sqlite schema's header anticipated.
 * Same table/column NAMES and the same conservative shapes: TEXT ids and
 * ISO-8601 UTC TEXT timestamps (never `timestamptz`, so the domain's
 * string contract is byte-identical across engines), `boolean` where sqlite
 * used `integer({mode:'boolean'})`, and `jsonb` where sqlite used
 * `text({mode:'json'})` (both hand Drizzle a parsed object). Repositories and
 * the data model are unchanged — only the driver differs.
 */

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    // Uniqueness is enforced case-insensitively by users_email_ci_unique below
    // (stronger than a plain unique), so a single constraint name covers dups.
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    role: text('role').$type<Role>().notNull(),
    passwordHash: text('password_hash').notNull(),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    slackUserId: text('slack_user_id'),
    isActive: boolean('is_active').notNull(),
    timezone: text('timezone').notNull().default(DEFAULT_TIMEZONE),
    theme: text('theme').$type<Theme>().notNull().default(DEFAULT_THEME),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    // Case-insensitive email uniqueness (the sqlite COLLATE NOCASE equivalent).
    uniqueIndex('users_email_ci_unique').on(sql`lower(${table.email})`),
    index('users_display_name_ci_idx').on(sql`lower(${table.displayName})`),
  ],
)

export const boards = pgTable('boards', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull(),
})

export const lanes = pgTable(
  'lanes',
  {
    id: text('id').primaryKey(),
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id),
    key: text('key').$type<LaneKey>().notNull(),
    label: text('label').notNull(),
    position: integer('position').notNull(),
    wipLimit: integer('wip_limit'),
  },
  (table) => [unique('lanes_board_id_key_unique').on(table.boardId, table.key)],
)

export const locations = pgTable('locations', {
  id: text('id').primaryKey(),
  parentId: text('parent_id').references((): AnyPgColumn => locations.id),
  kind: text('kind').$type<LocationKind>().notNull(),
  name: text('name').notNull(),
})

export const boardPolicies = pgTable(
  'board_policies',
  {
    id: text('id').primaryKey(),
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id),
    config: jsonb('config').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('board_policies_board_id_created_at_idx').on(table.boardId, table.createdAt)],
)

export const cards = pgTable(
  'cards',
  {
    // App-assigned per-board sequential id (MAX(id)+1), not a serial sequence.
    id: integer('id').primaryKey(),
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id),
    laneId: text('lane_id')
      .notNull()
      .references(() => lanes.id),
    // Byte-wise collation so the base-62 fractional keys order correctly (ADR-006).
    position: byteText('position').notNull(),
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
    resolution: text('resolution').$type<Resolution>(),
    blocked: boolean('blocked').notNull().default(false),
    blockedReason: text('blocked_reason'),
    blockedAt: text('blocked_at'),
    waitingReason: text('waiting_reason').$type<WaitingReason>(),
    expectedResumeAt: text('expected_resume_at'),
    resumeAlertedAt: text('resume_alerted_at'),
    workStartedAt: text('work_started_at'),
    slackChannelId: text('slack_channel_id'),
    slackThreadTs: text('slack_thread_ts'),
    slackPermalink: text('slack_permalink'),
    version: integer('version').notNull().default(1),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    archivedAt: text('archived_at'),
  },
  (table) => [
    uniqueIndex('cards_lane_id_position_unique').on(table.laneId, table.position),
    index('cards_board_id_archived_at_idx').on(table.boardId, table.archivedAt),
    index('cards_assignee_id_idx').on(table.assigneeId),
    index('cards_reporter_id_idx').on(table.reporterId),
    index('cards_created_at_id_idx').on(table.createdAt, table.id),
    index('cards_lane_active_position_idx')
      .on(table.laneId, table.position)
      .where(sql`${table.archivedAt} is null`),
    index('cards_blocked_active_idx')
      .on(table.createdAt, table.id)
      .where(sql`${table.blocked} = true and ${table.archivedAt} is null`),
  ],
)

export const tags = pgTable(
  'tags',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
  },
  // Case-insensitive uniqueness (the sqlite nocase-text equivalent).
  (table) => [uniqueIndex('tags_name_ci_unique').on(sql`lower(${table.name})`)],
)

export const cardTags = pgTable(
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

export const comments = pgTable(
  'comments',
  {
    id: text('id').primaryKey(),
    cardId: integer('card_id')
      .notNull()
      .references(() => cards.id),
    parentCommentId: text('parent_comment_id').references((): AnyPgColumn => comments.id),
    authorId: text('author_id')
      .notNull()
      .references(() => users.id),
    body: text('body').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    deletedAt: text('deleted_at'),
  },
  (table) => [index('comments_card_id_created_at_idx').on(table.cardId, table.createdAt)],
)

export const attachments = pgTable(
  'attachments',
  {
    id: text('id').primaryKey(),
    cardId: integer('card_id')
      .notNull()
      .references(() => cards.id),
    filename: text('filename').notNull(),
    mime: text('mime').notNull(),
    bytes: integer('bytes').notNull(),
    sha256: text('sha256').notNull(),
    storageKey: text('storage_key').notNull(),
    uploadedBy: text('uploaded_by')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
    deletedAt: text('deleted_at'),
  },
  (table) => [index('attachments_card_id_idx').on(table.cardId)],
)

export const cardEvents = pgTable(
  'card_events',
  {
    id: text('id').primaryKey(),
    cardId: integer('card_id')
      .notNull()
      .references(() => cards.id),
    actorId: text('actor_id'),
    actorKind: text('actor_kind').$type<ActorKind>().notNull(),
    /** Denormalized OAuth client name for `agent` events (on-behalf-of audit,
     * ADR-021 §E); NULL for every other actor kind. */
    actorLabel: text('actor_label'),
    eventType: text('event_type').$type<CardEventType>().notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('card_events_card_id_created_at_idx').on(table.cardId, table.createdAt)],
)

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  createdAt: text('created_at').notNull(),
  expiresAt: text('expires_at').notNull(),
  lastSeenAt: text('last_seen_at').notNull(),
})

export const serviceTokens = pgTable(
  'service_tokens',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull(),
    role: text('role').$type<Role>().notNull(),
    scope: text('scope').$type<TokenScope>().notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
    lastUsedAt: text('last_used_at'),
    revokedAt: text('revoked_at'),
  },
  (table) => [uniqueIndex('service_tokens_token_hash_unique').on(table.tokenHash)],
)

/** Dynamically-registered OAuth clients (ADR-021) — pg twin of oauth_clients. */
export const oauthClients = pgTable('oauth_clients', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  redirectUris: jsonb('redirect_uris').$type<string[]>().notNull(),
  createdAt: text('created_at').notNull(),
})

/** Short-lived single-use OAuth authorization codes (ADR-021) — pg twin. */
export const oauthAuthorizationCodes = pgTable('oauth_authorization_codes', {
  codeHash: text('code_hash').primaryKey(),
  clientId: text('client_id')
    .notNull()
    .references(() => oauthClients.id),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  redirectUri: text('redirect_uri').notNull(),
  resource: text('resource').notNull(),
  scope: text('scope').$type<TokenScope>().notNull(),
  codeChallenge: text('code_challenge').notNull(),
  codeChallengeMethod: text('code_challenge_method').$type<'S256'>().notNull(),
  expiresAt: text('expires_at').notNull(),
})

/** Opaque, sha256-hashed OAuth access tokens (ADR-021) — pg twin. */
export const oauthAccessTokens = pgTable(
  'oauth_access_tokens',
  {
    id: text('id').primaryKey(),
    tokenHash: text('token_hash').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClients.id),
    scope: text('scope').$type<TokenScope>().notNull(),
    resource: text('resource').notNull(),
    expiresAt: text('expires_at').notNull(),
    revokedAt: text('revoked_at'),
    lastUsedAt: text('last_used_at'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [uniqueIndex('oauth_access_tokens_token_hash_unique').on(table.tokenHash)],
)

/** Rotating, sha256-hashed OAuth refresh tokens (ADR-021) — pg twin. */
export const oauthRefreshTokens = pgTable(
  'oauth_refresh_tokens',
  {
    id: text('id').primaryKey(),
    tokenHash: text('token_hash').notNull(),
    familyId: text('family_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClients.id),
    scope: text('scope').$type<TokenScope>().notNull(),
    resource: text('resource').notNull(),
    expiresAt: text('expires_at').notNull(),
    usedAt: text('used_at'),
    revokedAt: text('revoked_at'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [uniqueIndex('oauth_refresh_tokens_token_hash_unique').on(table.tokenHash)],
)

export const filterPresets = pgTable(
  'filter_presets',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    filter: jsonb('filter').notNull(),
    shared: boolean('shared').notNull().default(false),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('filter_presets_owner_id_created_at_idx').on(table.ownerId, table.createdAt),
    index('filter_presets_shared_created_at_idx')
      .on(table.createdAt)
      .where(sql`${table.shared} = true`),
  ],
)

export const cardRelations = pgTable(
  'card_relations',
  {
    id: text('id').primaryKey(),
    fromCardId: integer('from_card_id')
      .notNull()
      .references(() => cards.id),
    toCardId: integer('to_card_id')
      .notNull()
      .references(() => cards.id),
    type: text('type').$type<RelationType>().notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('card_relations_from_to_type_unique').on(
      table.fromCardId,
      table.toCardId,
      table.type,
    ),
    index('card_relations_from_card_idx').on(table.fromCardId),
    index('card_relations_to_card_idx').on(table.toCardId),
  ],
)

export const cardWatchers = pgTable(
  'card_watchers',
  {
    cardId: integer('card_id')
      .notNull()
      .references(() => cards.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.cardId, table.userId] })],
)

export const notifications = pgTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    cardId: integer('card_id')
      .notNull()
      .references(() => cards.id),
    actorId: text('actor_id'),
    eventType: text('event_type').$type<NotificationKind>().notNull(),
    /** Deep-link target comment (mention / comment.added), else null; FK-free like actor_id. */
    commentId: text('comment_id'),
    createdAt: text('created_at').notNull(),
    readAt: text('read_at'),
  },
  (table) => [index('notifications_user_id_created_at_idx').on(table.userId, table.createdAt)],
)
