import { type Priority, type WaitingReason } from '../domain/constants.ts'
import { type CursorKey } from '../domain/cursor.ts'
import {
  type Attachment,
  type Card,
  type Comment,
  type Lane,
  type Location,
  type Tag,
  type User,
} from '../domain/entities.ts'
import { type CardEvent, type CardEventType } from '../domain/events.ts'
import { type BoardPolicy } from '../domain/policy.ts'

/**
 * Repository ports owned by core, implemented by packages/db (ADR-004).
 * Surfaces are deliberately minimal: only what the services consume.
 */

/** Filters for the card list query; keys the db adapter can push into SQL. */
export interface CardQueryFilter {
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
  /** Every card in the lane (archived included), ordered by position ascending. */
  listByLane(laneId: string): Promise<Card[]>
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

export interface LaneRepository {
  /** Board order (position ascending). */
  listByBoard(boardId: string): Promise<Lane[]>
  findByKey(boardId: string, key: string): Promise<Lane | null>
}

export interface LocationRepository {
  findById(id: string): Promise<Location | null>
}

export interface TagRepository {
  /** Case-insensitive name lookup (name is UNIQUE COLLATE NOCASE). */
  findByNameCi(name: string): Promise<Tag | null>
  insert(tag: Tag): Promise<void>
  /** The card's tags in their stored (case-preserved) form. */
  listByCard(cardId: string): Promise<Tag[]>
  /** Full-replacement of the card_tags rows. */
  setCardTags(cardId: string, tagIds: string[]): Promise<void>
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
}

/** The repositories available inside one atomic unit of work. */
export interface TransactionContext {
  cards: CardRepository
  comments: CommentRepository
  attachments: AttachmentRepository
  users: UserRepository
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
}
