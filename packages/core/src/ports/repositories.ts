import { type ActorKind, type Priority, type WaitingReason } from '../domain/constants.ts'
import { type CursorKey } from '../domain/cursor.ts'
import {
  type Attachment,
  type Card,
  type Comment,
  type Lane,
  type Location,
  type ServiceToken,
  type Session,
  type Tag,
  type User,
} from '../domain/entities.ts'
import { type BoardCardExtras } from '../domain/envelopes.ts'
import { type CardEvent, type CardEventType } from '../domain/events.ts'
import { type FilterPreset } from '../domain/filters.ts'
import { type Notification } from '../domain/notifications.ts'
import { type CardRelation, type RelationType } from '../domain/relations.ts'
import { type BoardPolicy } from '../domain/policy.ts'

/**
 * Repository ports owned by core, implemented by packages/db (ADR-004).
 * Surfaces are deliberately minimal: only what the services consume.
 */

/**
 * A board summary row: the active card plus the lean, join-sourced extras the
 * board card renders (tag names, active-attachment count, location label).
 * The adapter computes the extras with joins so the hottest read stays one
 * query per lane instead of N+1 lookups per card.
 */
export interface BoardCardRow {
  card: Card
  extras: BoardCardExtras
}

/** Filters for the card list query; keys the db adapter can push into SQL. */
export interface CardQueryFilter {
  /** Board scope for legs not already scoped through a lane (multi-board seam). */
  boardId?: string
  laneId?: string
  /** Any-of lane ids (the board-filter multi-select); OR-ed with each other. */
  laneIds?: string[]
  assigneeId?: string
  /** Any-of assignee user ids (board-filter multi-select). */
  assigneeIds?: string[]
  reporterId?: string
  /** Any-of reporter user ids (board-filter multi-select). */
  reporterIds?: string[]
  priority?: Priority
  /** Any-of priorities (board-filter multi-select). */
  priorities?: Priority[]
  /** Location ids to match a card's own location against — a selected location
   * plus its descendants, so a location filter is recursively inclusive. */
  locationIds?: string[]
  /** Tag names (any-of), matched case-insensitively: a card with at least one. */
  tags?: string[]
  blocked?: boolean
  waitingReason?: WaitingReason
  /** Matches cards whose expectedResumeAt is strictly before this `YYYY-MM-DD` date. */
  overdueBefore?: string
  /**
   * The board-filter `overdue` candidate predicate: restrict to cards that CAN
   * be overdue (`work_started_at IS NOT NULL AND estimate_minutes IS NOT NULL`).
   * The business-minutes verdict itself is finished in the service over this
   * bounded set — SQLite cannot count business hours (board-filters.md).
   */
  overdueCandidate?: boolean
  /** Case-insensitive substring over title + description. */
  q?: string
  /** Default false: archived cards are excluded. */
  includeArchived?: boolean
  /** Restrict to archived cards only (takes precedence over includeArchived). */
  archivedOnly?: boolean
}

export interface CardRepository {
  findById(id: number): Promise<Card | null>
  /**
   * The next card id for the board — `MAX(id) + 1`, or 1 for the first card.
   * The id IS the sequential per-board ticket number. Called inside the create
   * transaction; SQLite's single writer makes read-then-insert atomic, and the
   * id PRIMARY KEY is the backstop (the Postgres port would use a sequence).
   */
  nextCardId(boardId: string): Promise<number>
  /** May reject with DuplicatePositionError — the UNIQUE(laneId, position) backstop. */
  insert(card: Card): Promise<void>
  /** May reject with DuplicatePositionError — the UNIQUE(laneId, position) backstop. */
  update(card: Card): Promise<void>
  /**
   * Cards in the lane ordered by position ascending. Archived rows are
   * included by default (they keep occupying the lane's UNIQUE(laneId,
   * position) space); `activeOnly` pushes the `archived_at IS NULL` filter
   * into the adapter so hot reads (board snapshot, WIP checks) never hydrate
   * the ever-growing done-lane archive.
   */
  listByLane(laneId: string, options?: { activeOnly?: boolean }): Promise<Card[]>
  /**
   * Non-archived cards in the lane in position order, each with the board
   * summary's join-sourced extras (tag names, active-attachment count,
   * location label). The board snapshot is the hottest read in the system, so
   * the adapter resolves the extras with joins in a bounded number of queries
   * per lane rather than a per-card lookup fan-out.
   */
  listBoardSummariesByLane(laneId: string): Promise<BoardCardRow[]>
  /**
   * Board summaries (card + join-sourced extras) matching `filter`, in position
   * order — the filtered-board read (docs/architecture/board-filters.md). Same
   * extras and ordering as `listBoardSummariesByLane`, but the whole matching
   * set across lanes rather than one lane, with the filter pushed into SQL
   * (never in-memory). The `overdue` verdict is finished in the service over
   * this set via the `overdueCandidate` predicate. The service groups by lane.
   */
  queryBoardSummaries(filter: CardQueryFilter): Promise<BoardCardRow[]>
  /**
   * COUNT of non-archived cards in the lane — the WIP-marker read inside the
   * move transaction, which must not hydrate rows just to take a length
   * (soft limits mean lane size is unbounded).
   */
  countActiveByLane(laneId: string): Promise<number>
  /**
   * The first/last card of a lane by position — an O(1) `ORDER BY position
   * LIMIT 1` boundary read (archived rows included: they occupy position
   * space). Null for an empty lane.
   */
  edgeOfLane(laneId: string, edge: 'first' | 'last'): Promise<Card | null>
  /**
   * Filtered list, newest-first: `ORDER BY createdAt DESC, id DESC` — the id
   * tie-break is descending too. When `page.after` is set, returns only rows
   * strictly older than the cursor tuple, i.e.
   * `(createdAt, id) < (after.createdAt, after.id)` under that ordering.
   * BoardQueryService pagination depends on these exact semantics (tie-break
   * direction AND strict inequality); adapters must match them or rows
   * sharing a createdAt millisecond are skipped/duplicated across pages.
   * Omitting `page` returns all matches.
   */
  query(filter: CardQueryFilter, page?: { after?: CursorKey; limit?: number }): Promise<Card[]>
}

export interface CommentRepository {
  findById(id: string): Promise<Comment | null>
  insert(comment: Comment): Promise<void>
  update(comment: Comment): Promise<void>
  /** Oldest-first on (createdAt, id); soft-deleted rows included (thread shape). */
  listByCard(cardId: number): Promise<Comment[]>
}

export interface AttachmentRepository {
  findById(id: string): Promise<Attachment | null>
  insert(attachment: Attachment): Promise<void>
  update(attachment: Attachment): Promise<void>
  /** All rows for the card, oldest-first; callers filter soft-deleted. */
  listByCard(cardId: number): Promise<Attachment[]>
}

export interface UserRepository {
  findById(id: string): Promise<User | null>
}

/**
 * The async user-picker read filter (`UserAccountRepository.search`), pushed
 * into an index-backed SQL query so the assignee/reporter pickers scale past
 * 10k users without ever loading the whole roster. Two combinable legs:
 *
 * - `q` — case-insensitive substring over display name AND email. Empty string
 *   matches everyone (the picker's pre-type "first N" list).
 * - `ids` — when set, resolves exactly those user ids (an `id IN (…)`
 *   allowlist) INSTEAD of substring-searching, for already-selected values on
 *   a card / saved preset. Bounded by the caller; unknown ids are absent.
 *
 * `activeOnly` and `excludeId` are the business rules (skip deactivated users
 * in search, always drop the automation user) pushed into SQL rather than
 * post-filtered, so the row cap and ordering stay correct. Ordered by display
 * name then id; capped at `limit`.
 */
export interface UserSearchFilter {
  q: string
  limit: number
  ids?: string[]
  activeOnly?: boolean
  excludeId?: string
}

/**
 * A user row plus its stored password hash. Auth-surface only (login,
 * change-password): the hash never enters the `User` entity, so response
 * schemas are structurally unable to leak it (docs/architecture/security.md).
 */
export interface UserCredentials {
  user: User
  passwordHash: string
}

/**
 * Full user-account surface consumed by the server's auth handlers and the
 * admin users CRUD (docs/architecture/rest-api.md#auth--users). Core services
 * never touch it — they read users via the hash-free `UserRepository`.
 */
export interface UserAccountRepository {
  /** Case-insensitive email lookup, hash included (login). */
  findByEmail(email: string): Promise<UserCredentials | null>
  /**
   * Sticky Slack identity binding (docs/architecture/slack.md#identity-mapping):
   * exact match on the stored `users.slack_user_id`, or null when no user has
   * been bound to that Slack id yet.
   */
  findBySlackUserId(slackUserId: string): Promise<UserCredentials | null>
  /** Lookup by id, hash included (change-password verifies the current one). */
  findById(id: string): Promise<UserCredentials | null>
  /** Every user, active and inactive (admin management, last-admin guard). */
  list(): Promise<User[]>
  /**
   * The async user-picker read (`GET /users/search`) — the scalable path that
   * must never hydrate the whole roster (10k+ users). See `UserSearchFilter`:
   * case-insensitive substring over display name AND email (or an `ids`
   * allowlist), `activeOnly`/`excludeId` pushed into SQL, ordered by display
   * name then id, capped at `filter.limit`. Empty `q` returns the first
   * `limit` users so the picker shows something before typing.
   */
  search(filter: UserSearchFilter): Promise<User[]>
  /**
   * COUNT of user rows excluding the seeded automation user — ANY status:
   * deactivated accounts still count, so the first-boot setup flow (enabled
   * only at zero) can never reopen on a live system
   * (docs/architecture/rest-api.md#auth--users).
   */
  countHumanUsers(excludedSystemUserId: string): Promise<number>
  /** Rejects a duplicate email (UNIQUE) with ConflictError. */
  insert(user: User, passwordHash: string): Promise<void>
  /** Updates profile fields (displayName/role/isActive/mustChangePassword) — never the hash. */
  update(user: User): Promise<void>
  /** Replaces the hash and sets the mustChangePassword flag atomically. */
  setPassword(userId: string, passwordHash: string, mustChangePassword: boolean): Promise<void>
}

/**
 * Server-side web sessions (ADR-009). `id` is always the sha256 hex of the
 * raw cookie value — the raw 256-bit id exists only in the cookie. Expiry is
 * folded into `expiresAt` at write time (`min(lastSeen + idle, createdAt +
 * absolute)`), so validity is a single timestamp comparison.
 */
export interface SessionRepository {
  create(session: Session): Promise<void>
  findByHash(idHash: string): Promise<Session | null>
  /** Sliding renewal: updates lastSeenAt and the folded expiresAt. */
  touch(idHash: string, lastSeenAt: string, expiresAt: string): Promise<void>
  /** Deletes one session (logout). Missing hash is a no-op. */
  revoke(idHash: string): Promise<void>
  /**
   * Deletes every session of the user except `exceptIdHash` (all of them when
   * omitted) — password change keeps the current session; role change and
   * deactivation revoke everything (docs/architecture/security.md).
   */
  revokeOthersForUser(userId: string, exceptIdHash?: string): Promise<void>
  /** Purges sessions with `expiresAt <= nowIso`; returns the count (daily job). */
  deleteExpired(nowIso: string): Promise<number>
}

/**
 * MCP/automation bearer credentials (ADR-009). The raw `rkb_…` token is shown
 * once at creation; only its sha256 is stored. Revocation is the only
 * lifecycle end — rows are never deleted (audit trail of issued credentials).
 */
export interface ServiceTokenRepository {
  /** Hash lookup including revoked rows — callers check `revokedAt`. */
  findByHash(tokenHash: string): Promise<ServiceToken | null>
  updateLastUsed(id: string, lastUsedAt: string): Promise<void>
  /** All tokens, newest first (admin list). */
  list(): Promise<ServiceToken[]>
  /** Rejects a duplicate tokenHash (UNIQUE backstop) with ConflictError. */
  insert(token: ServiceToken): Promise<void>
  /** Sets revokedAt (idempotent); NotFoundError when the id does not exist. */
  revoke(id: string, revokedAt: string): Promise<void>
  /**
   * Swaps in a fresh tokenHash for an active token (rotation), returning the
   * updated row. NotFoundError for an unknown id; ConflictError for a revoked
   * one (a dead credential cannot be revived).
   */
  rotateHash(id: string, tokenHash: string): Promise<ServiceToken>
}

export interface LaneRepository {
  /** Board order (position ascending). */
  listByBoard(boardId: string): Promise<Lane[]>
  findByKey(boardId: string, key: string): Promise<Lane | null>
  /** Persists label/wipLimit edits; NotFoundError when the id does not exist. */
  update(lane: Lane): Promise<void>
  /** Appends an admin-created column (its position is the caller's next slot). */
  insert(lane: Lane): Promise<void>
  /**
   * Removes a lane. The caller guarantees it is deletable (not a seeded lane)
   * and empty; a lingering card reference surfaces as a ConflictError.
   * NotFoundError when the id does not exist.
   */
  remove(laneId: string): Promise<void>
  /** Rewrites lane positions to match `orderedIds` (board order), in one transaction. */
  reorder(boardId: string, orderedIds: string[]): Promise<void>
}

export interface LocationRepository {
  findById(id: string): Promise<Location | null>
  /** Case-insensitive name lookup (Slack draft resolution; mirrors tags.findByNameCi). */
  findByNameCi(name: string): Promise<Location | null>
  /** Every location row; clients assemble the tree from parentId. */
  list(): Promise<Location[]>
  insert(location: Location): Promise<void>
  update(location: Location): Promise<void>
  /**
   * Recursive hard delete: removes the whole subtree rooted at `id` (a
   * building takes its floors and their rooms with it) in one transaction, and
   * clears `location_id` on every card that referenced any removed node — the
   * card survives, location being optional. Deleting a location with children
   * therefore succeeds; it never conflicts. Rejects with NotFoundError only
   * when `id` does not exist.
   */
  delete(id: string): Promise<void>
}

export interface TagRepository {
  /** Case-insensitive name lookup (name is UNIQUE COLLATE NOCASE). */
  findByNameCi(name: string): Promise<Tag | null>
  insert(tag: Tag): Promise<void>
  /** The card's tags in their stored (case-preserved) form. */
  listByCard(cardId: number): Promise<Tag[]>
  /** Full-replacement of the card_tags rows. */
  setCardTags(cardId: number, tagIds: string[]): Promise<void>
  /** Every known tag, name order (autocomplete: GET /tags). */
  listAll(): Promise<Tag[]>
}

export interface PolicyRepository {
  /** Newest policy version for the board, or null before seeding. */
  getActive(boardId: string): Promise<BoardPolicy | null>
  /** Append-only: never updates or deletes prior versions. */
  insert(policy: BoardPolicy): Promise<void>
}

export interface EventRepository {
  /** Append-only — the audit trail is never updated or deleted (ADR-005). */
  append(event: CardEvent): Promise<void>
  /** One event by id, or null — the notification fan-out resolves the actor. */
  findById(id: string): Promise<CardEvent | null>
  /**
   * Per-card history, oldest-first: `ORDER BY createdAt ASC, id ASC`. When
   * `after` is set, returns only rows strictly newer than the cursor tuple,
   * i.e. `(createdAt, id) > (after.createdAt, after.id)`. Optional
   * event-type filter. Adapters must match the tie-break direction and the
   * strict inequality exactly (see CardRepository.query).
   */
  listByCard(
    cardId: number,
    options?: { types?: readonly CardEventType[]; after?: CursorKey; limit?: number },
  ): Promise<CardEvent[]>
  /**
   * The newest `limit` events for a card, newest-first:
   * `ORDER BY createdAt DESC, id DESC LIMIT n` — the trailing slice of the
   * card's history in O(limit), regardless of history depth. Tie-break
   * direction mirrors `listByCard` exactly (id disambiguates equal
   * timestamps). The optional type filter keeps "when did this card last
   * enter lane X" reads O(1) instead of full-history scans.
   */
  listLatestByCard(
    cardId: number,
    limit: number,
    types?: readonly CardEventType[],
  ): Promise<CardEvent[]>
  /**
   * Board-wide activity feed, newest-first: `ORDER BY createdAt DESC, id DESC`
   * across ALL cards, only events with `createdAt >= sinceIso`. When `after` is
   * set, returns only rows strictly older than the cursor tuple, i.e.
   * `(createdAt, id) < (after.createdAt, after.id)` under that ordering —
   * mirroring `CardRepository.query` exactly (tie-break direction AND strict
   * inequality), which `BoardQueryService.eventsSince` pagination depends on.
   * Optional filters: event type, a single card id, actor kind, and `actorIds`
   * (an `actorId IN (…)` allowlist — the self-scoped activity feed's gate,
   * pushed into SQL so pagination stays correct; an empty array matches nothing).
   */
  listBoardSince(
    sinceIso: string,
    options?: {
      types?: readonly CardEventType[]
      cardId?: number
      actorKind?: ActorKind
      actorIds?: readonly string[]
      after?: CursorKey
      limit?: number
    },
  ): Promise<CardEvent[]>
}

/**
 * Saved board filters (docs/architecture/board-filters.md). **Per-user by
 * default**: a preset is private to its owner unless `shared` is set, which
 * makes it visible team-wide. Reads (`listVisibleTo`) return the user's own
 * presets plus every shared one; every WRITE stays scoped by `ownerId`, so an
 * id owned by another user is indistinguishable from a missing one to a writer
 * (the service maps both to 404) — a shared preset is readable by all but
 * editable only by its owner. Rows are hard-deleted (no soft delete — a preset
 * carries no audit weight).
 */
export interface FilterPresetRepository {
  /** Presets visible to `userId`: their own plus every team-shared one, newest-first. */
  listVisibleTo(userId: string): Promise<FilterPreset[]>
  /** One preset IF it belongs to `ownerId`; null for unknown OR another owner's. */
  findByIdForOwner(id: string, ownerId: string): Promise<FilterPreset | null>
  insert(preset: FilterPreset): Promise<void>
  /** Persists name/filter/shared edits; NotFoundError when no row with (id, ownerId). */
  update(preset: FilterPreset): Promise<void>
  /** Hard-deletes IF owned by `ownerId`; NotFoundError otherwise. */
  delete(id: string, ownerId: string): Promise<void>
}

/**
 * Typed card-to-card relations (docs/architecture/card-relations.md). One
 * directed row per relation (`from → to` + type); a card's relations are every
 * row touching it on either end. No soft delete — a relation carries no audit
 * weight.
 */
export interface CardRelationRepository {
  /** Every relation touching `cardId` (as `from` OR `to`), newest-first. */
  listByCard(cardId: number): Promise<CardRelation[]>
  findById(id: string): Promise<CardRelation | null>
  /** True when an identical `(fromCardId, toCardId, type)` row already exists. */
  exists(fromCardId: number, toCardId: number, type: RelationType): Promise<boolean>
  insert(relation: CardRelation): Promise<void>
  /** Hard-deletes by id; a no-op when the id is unknown (the service pre-checks). */
  delete(id: string): Promise<void>
}

/**
 * Per-user-per-card WATCH subscriptions (docs/architecture/notifications.md). A
 * row's PRESENCE means the user watches the card — the source of who gets
 * notified about it. Reporters/assignees are auto-watched; a mention auto-
 * watches; a user can watch/unwatch any accessible card. `(cardId, userId)` is
 * unique, so `add` is idempotent.
 */
export interface CardWatcherRepository {
  /** True when `userId` currently watches `cardId`. */
  isWatching(cardId: number, userId: string): Promise<boolean>
  /** Every user id watching `cardId` — the notification fan-out set. */
  listWatcherIds(cardId: number): Promise<string[]>
  /** Idempotent: watching an already-watched card is a no-op. */
  add(cardId: number, userId: string, createdAt: string): Promise<void>
  /** Idempotent: unwatching a not-watched card is a no-op. */
  remove(cardId: number, userId: string): Promise<void>
}

/**
 * In-app notifications (docs/architecture/notifications.md). One row per
 * (recipient, triggering card event). Insert-only until read; reads are scoped
 * to the recipient (`userId`), so a user only ever sees or marks their own.
 */
export interface NotificationRepository {
  insert(notification: Notification): Promise<void>
  /** The user's notifications, newest-first; `unreadOnly` restricts to unread. Capped by `limit`. */
  listForUser(
    userId: string,
    options: { limit: number; unreadOnly?: boolean },
  ): Promise<Notification[]>
  /** Count of the user's UNREAD notifications (the bell badge). */
  unreadCount(userId: string): Promise<number>
  /** Marks one notification read IF it belongs to `userId`; no-op otherwise. */
  markRead(id: string, userId: string, readAt: string): Promise<void>
  /** Marks every unread notification of `userId` read; returns the count affected. */
  markAllRead(userId: string, readAt: string): Promise<number>
}

/** The repositories available inside one atomic unit of work. */
export interface TransactionContext {
  cards: CardRepository
  comments: CommentRepository
  attachments: AttachmentRepository
  users: UserRepository
  userAccounts: UserAccountRepository
  sessions: SessionRepository
  serviceTokens: ServiceTokenRepository
  lanes: LaneRepository
  locations: LocationRepository
  tags: TagRepository
  policies: PolicyRepository
  events: EventRepository
  filterPresets: FilterPresetRepository
  cardRelations: CardRelationRepository
  cardWatchers: CardWatcherRepository
  notifications: NotificationRepository
}

/**
 * Runs `fn` transactionally: every repository mutation inside commits together
 * or not at all — audit events are written in the same transaction as the
 * mutation they record (ADR-005).
 */
export interface UnitOfWork {
  run<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T>
  /**
   * Read-only unit of work: a consistent snapshot of committed state that
   * never takes the write lock, so pure reads (board snapshot, session
   * authentication, list queries) do not queue behind writers or long job
   * transactions. `fn` must not mutate — the SQLite adapter enforces this
   * with a read-only connection.
   */
  read<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T>
}
