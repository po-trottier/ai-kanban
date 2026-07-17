import { type Priority, type WaitingReason } from '../domain/constants.ts'
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
  assigneeId?: string
  reporterId?: string
  priority?: Priority
  /** Tag name, matched case-insensitively. */
  tag?: string
  blocked?: boolean
  waitingReason?: WaitingReason
  /** Matches cards whose expectedResumeAt is strictly before this `YYYY-MM-DD` date. */
  overdueBefore?: string
  /** Case-insensitive substring over title + description. */
  q?: string
  /** Default false: archived cards are excluded. */
  includeArchived?: boolean
}

export interface CardRepository {
  findById(id: string): Promise<Card | null>
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
  listByCard(cardId: string): Promise<Comment[]>
}

export interface AttachmentRepository {
  findById(id: string): Promise<Attachment | null>
  insert(attachment: Attachment): Promise<void>
  update(attachment: Attachment): Promise<void>
  /** All rows for the card, oldest-first; callers filter soft-deleted. */
  listByCard(cardId: string): Promise<Attachment[]>
}

export interface UserRepository {
  findById(id: string): Promise<User | null>
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
}

export interface LaneRepository {
  /** Board order (position ascending). */
  listByBoard(boardId: string): Promise<Lane[]>
  findByKey(boardId: string, key: string): Promise<Lane | null>
  /** Persists label/wipLimit edits; NotFoundError when the id does not exist. */
  update(lane: Lane): Promise<void>
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
   * Hard delete. Rejects with ConflictError while rows still reference the
   * location (child locations, cards) — the FK constraints are the backstop.
   */
  delete(id: string): Promise<void>
}

export interface TagRepository {
  /** Case-insensitive name lookup (name is UNIQUE COLLATE NOCASE). */
  findByNameCi(name: string): Promise<Tag | null>
  insert(tag: Tag): Promise<void>
  /** The card's tags in their stored (case-preserved) form. */
  listByCard(cardId: string): Promise<Tag[]>
  /** Full-replacement of the card_tags rows. */
  setCardTags(cardId: string, tagIds: string[]): Promise<void>
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
  /**
   * Per-card history, oldest-first: `ORDER BY createdAt ASC, id ASC`. When
   * `after` is set, returns only rows strictly newer than the cursor tuple,
   * i.e. `(createdAt, id) > (after.createdAt, after.id)`. Optional
   * event-type filter. Adapters must match the tie-break direction and the
   * strict inequality exactly (see CardRepository.query).
   */
  listByCard(
    cardId: string,
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
    cardId: string,
    limit: number,
    types?: readonly CardEventType[],
  ): Promise<CardEvent[]>
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
