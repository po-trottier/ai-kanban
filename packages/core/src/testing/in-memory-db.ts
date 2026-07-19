import { type ActorKind } from '../domain/constants.ts'
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
import { ConflictError, DuplicatePositionError, NotFoundError } from '../domain/errors.ts'
import { type CardEvent, type CardEventType } from '../domain/events.ts'
import { type FilterPreset } from '../domain/filters.ts'
import { type CardRelation, type RelationType } from '../domain/relations.ts'
import { type BoardPolicy } from '../domain/policy.ts'
import {
  type AttachmentRepository,
  type BoardCardRow,
  type CardQueryFilter,
  type CardRelationRepository,
  type CardRepository,
  type CommentRepository,
  type EventRepository,
  type FilterPresetRepository,
  type LaneRepository,
  type LocationRepository,
  type PolicyRepository,
  type ServiceTokenRepository,
  type SessionRepository,
  type TagRepository,
  type TransactionContext,
  type UnitOfWork,
  type UserAccountRepository,
  type UserCredentials,
  type UserRepository,
  type UserSearchFilter,
} from '../ports/repositories.ts'

/**
 * Hand-written in-memory fake of the persistence ports (docs/dev/testing.md).
 * The UnitOfWork is honest: `run` works on a deep copy of the committed state
 * and swaps it in only on success — mutations inside a failed transaction
 * never leak. The card repository enforces UNIQUE(laneId, position) and
 * throws DuplicatePositionError like the real backstop.
 */

interface CardTagRow {
  cardId: number
  tagId: string
}

/** userId → stored password hash rows (JSON-clonable; auth surface). */
interface PasswordHashRow {
  userId: string
  hash: string
}

interface DbState {
  lanes: Lane[]
  users: User[]
  passwordHashes: PasswordHashRow[]
  sessions: Session[]
  serviceTokens: ServiceToken[]
  locations: Location[]
  cards: Card[]
  comments: Comment[]
  attachments: Attachment[]
  tags: Tag[]
  cardTags: CardTagRow[]
  policies: BoardPolicy[]
  events: CardEvent[]
  filterPresets: FilterPreset[]
  cardRelations: CardRelation[]
}

function emptyState(): DbState {
  return {
    lanes: [],
    users: [],
    passwordHashes: [],
    sessions: [],
    serviceTokens: [],
    locations: [],
    cards: [],
    comments: [],
    attachments: [],
    tags: [],
    cardTags: [],
    policies: [],
    events: [],
    filterPresets: [],
    cardRelations: [],
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** Byte-wise string ordering, matching SQLite's BINARY collation. */
function binaryCompare(a: string, b: string): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

export class InMemoryDb implements UnitOfWork {
  private state: DbState = emptyState()
  /** Fault injection: the next card position write throws DuplicatePositionError once. */
  failNextCardPositionWrite = false

  async run<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
    const working = clone(this.state)
    const result = await fn(this.transactionOver(working))
    this.state = working
    return result
  }

  /** Read-only unit of work: `fn` sees a copy of committed state; nothing commits. */
  async read<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
    return fn(this.transactionOver(clone(this.state)))
  }

  private transactionOver(state: DbState): TransactionContext {
    return {
      cards: new InMemoryCardRepository(state, this),
      comments: new InMemoryCommentRepository(state),
      attachments: new InMemoryAttachmentRepository(state),
      users: new InMemoryUserRepository(state),
      userAccounts: new InMemoryUserAccountRepository(state),
      sessions: new InMemorySessionRepository(state),
      serviceTokens: new InMemoryServiceTokenRepository(state),
      lanes: new InMemoryLaneRepository(state),
      locations: new InMemoryLocationRepository(state),
      tags: new InMemoryTagRepository(state),
      policies: new InMemoryPolicyRepository(state),
      events: new InMemoryEventRepository(state),
      filterPresets: new InMemoryFilterPresetRepository(state),
      cardRelations: new InMemoryCardRelationRepository(state),
    }
  }

  // ── Committed-state helpers for arranging and asserting in tests ──

  seedLane(lane: Lane): void {
    this.state.lanes.push(clone(lane))
  }

  seedUser(user: User, passwordHash = '!in-memory-placeholder!'): void {
    this.state.users.push(clone(user))
    this.state.passwordHashes.push({ userId: user.id, hash: passwordHash })
  }

  seedSession(session: Session): void {
    this.state.sessions.push(clone(session))
  }

  /** Seeds a service token directly (mcp-actor attribution, self-scope tests). */
  seedServiceToken(token: ServiceToken): void {
    this.state.serviceTokens.push(clone(token))
  }

  /** Committed sessions for a user (asserting revocation behavior). */
  sessionsFor(userId: string): Session[] {
    return clone(this.state.sessions.filter((session) => session.userId === userId))
  }

  getServiceToken(id: string): ServiceToken {
    const token = this.state.serviceTokens.find((candidate) => candidate.id === id)
    if (!token) throw new NotFoundError('service token')
    return clone(token)
  }

  seedLocation(location: Location): void {
    this.state.locations.push(clone(location))
  }

  seedCard(card: Card): void {
    this.state.cards.push(clone(card))
  }

  seedAttachment(attachment: Attachment): void {
    this.state.attachments.push(clone(attachment))
  }

  seedTag(tag: Tag): void {
    this.state.tags.push(clone(tag))
  }

  seedCardTag(cardId: number, tagId: string): void {
    this.state.cardTags.push({ cardId, tagId })
  }

  seedPolicy(policy: BoardPolicy): void {
    this.state.policies.push(clone(policy))
  }

  /** Seeds a filter preset directly (per-user isolation / list-order tests). */
  seedFilterPreset(preset: FilterPreset): void {
    this.state.filterPresets.push(clone(preset))
  }

  /** Seeds a card relation directly (relation list/resolve tests). */
  seedCardRelation(relation: CardRelation): void {
    this.state.cardRelations.push(clone(relation))
  }

  getCard(id: number): Card {
    const card = this.state.cards.find((candidate) => candidate.id === id)
    if (!card) throw new NotFoundError('card')
    return clone(card)
  }

  getComment(id: string): Comment {
    const comment = this.state.comments.find((candidate) => candidate.id === id)
    if (!comment) throw new NotFoundError('comment')
    return clone(comment)
  }

  getAttachment(id: string): Attachment {
    const attachment = this.state.attachments.find((candidate) => candidate.id === id)
    if (!attachment) throw new NotFoundError('attachment')
    return clone(attachment)
  }

  /** Committed audit events for a card, in append order. */
  eventsFor(cardId: number): CardEvent[] {
    return clone(this.state.events.filter((event) => event.cardId === cardId))
  }

  /** Committed tag names for a card, in card_tags order. */
  tagNamesFor(cardId: number): string[] {
    return this.state.cardTags
      .filter((row) => row.cardId === cardId)
      .map((row) => this.state.tags.find((tag) => tag.id === row.tagId)?.name ?? '')
  }

  /** Committed cards in a lane, position order (archived included). */
  cardsInLane(laneId: string): Card[] {
    return clone(
      this.state.cards
        .filter((card) => card.laneId === laneId)
        .sort((a, b) => binaryCompare(a.position, b.position)),
    )
  }

  policyVersionCount(): number {
    return this.state.policies.length
  }
}

class InMemoryCardRepository implements CardRepository {
  private readonly state: DbState
  private readonly db: InMemoryDb

  constructor(state: DbState, db: InMemoryDb) {
    this.state = state
    this.db = db
  }

  findById(id: number): Promise<Card | null> {
    const card = this.state.cards.find((candidate) => candidate.id === id)
    return Promise.resolve(card ? clone(card) : null)
  }

  nextCardId(boardId: string): Promise<number> {
    const max = this.state.cards
      .filter((card) => card.boardId === boardId)
      .reduce((highest, card) => Math.max(highest, card.id), 0)
    return Promise.resolve(max + 1)
  }

  insert(card: Card): Promise<void> {
    this.assertUniquePosition(card)
    this.state.cards.push(clone(card))
    return Promise.resolve()
  }

  update(card: Card): Promise<void> {
    const index = this.state.cards.findIndex((candidate) => candidate.id === card.id)
    if (index === -1) return Promise.reject(new NotFoundError('card'))
    this.assertUniquePosition(card)
    this.state.cards.splice(index, 1, clone(card))
    return Promise.resolve()
  }

  listByLane(laneId: string, options?: { activeOnly?: boolean }): Promise<Card[]> {
    return Promise.resolve(
      clone(
        this.state.cards
          .filter((card) => card.laneId === laneId)
          .filter((card) => options?.activeOnly !== true || card.archivedAt === null)
          .sort((a, b) => binaryCompare(a.position, b.position)),
      ),
    )
  }

  async listBoardSummariesByLane(laneId: string): Promise<BoardCardRow[]> {
    const cards = await this.listByLane(laneId, { activeOnly: true })
    return cards.map((card) => this.summaryOf(card))
  }

  queryBoardSummaries(filter: CardQueryFilter): Promise<BoardCardRow[]> {
    const rows = this.state.cards
      .filter((card) => this.matches(card, filter))
      // Position order within each lane (the service groups by lane) — the
      // same BINARY collation ordering the summary read uses.
      .sort((a, b) => binaryCompare(a.position, b.position))
      .map((card) => this.summaryOf(card))
    return Promise.resolve(clone(rows))
  }

  private summaryOf(card: Card): BoardCardRow {
    const tagIds = new Set(
      this.state.cardTags.filter((row) => row.cardId === card.id).map((row) => row.tagId),
    )
    const tagNames = this.state.tags
      .filter((tag) => tagIds.has(tag.id))
      .map((tag) => tag.name)
      .sort((a, b) => binaryCompare(a, b))
    const attachmentCount = this.state.attachments.filter(
      (attachment) => attachment.cardId === card.id && attachment.deletedAt === null,
    ).length
    const locationLabel =
      card.locationId === null
        ? null
        : (this.state.locations.find((location) => location.id === card.locationId)?.name ?? null)
    return { card, extras: { tags: tagNames, attachmentCount, locationLabel } }
  }

  async countActiveByLane(laneId: string): Promise<number> {
    const cards = await this.listByLane(laneId, { activeOnly: true })
    return cards.length
  }

  async edgeOfLane(laneId: string, edge: 'first' | 'last'): Promise<Card | null> {
    const cards = await this.listByLane(laneId)
    return (edge === 'first' ? cards.at(0) : cards.at(-1)) ?? null
  }

  query(filter: CardQueryFilter, page?: { after?: CursorKey; limit?: number }): Promise<Card[]> {
    let cards = this.state.cards
      .filter((card) => this.matches(card, filter))
      .sort((a, b) =>
        a.createdAt === b.createdAt ? b.id - a.id : binaryCompare(b.createdAt, a.createdAt),
      )
    const after = page?.after
    if (after !== undefined) {
      // Card cursors carry the integer card id; Number() is a no-op on it.
      const afterId = Number(after.id)
      cards = cards.filter(
        (card) =>
          card.createdAt < after.createdAt ||
          (card.createdAt === after.createdAt && card.id < afterId),
      )
    }
    if (page?.limit !== undefined) cards = cards.slice(0, page.limit)
    return Promise.resolve(clone(cards))
  }

  private matches(card: Card, filter: CardQueryFilter): boolean {
    if (filter.archivedOnly === true) {
      if (card.archivedAt === null) return false
    } else if (filter.includeArchived !== true && card.archivedAt !== null) {
      return false
    }
    if (filter.boardId !== undefined && card.boardId !== filter.boardId) return false
    if (filter.laneId !== undefined && card.laneId !== filter.laneId) return false
    if (filter.laneIds !== undefined && !filter.laneIds.includes(card.laneId)) return false
    if (filter.assigneeId !== undefined && card.assigneeId !== filter.assigneeId) return false
    if (filter.assigneeIds !== undefined) {
      if (card.assigneeId === null || !filter.assigneeIds.includes(card.assigneeId)) return false
    }
    if (filter.reporterId !== undefined && card.reporterId !== filter.reporterId) return false
    if (filter.reporterIds !== undefined && !filter.reporterIds.includes(card.reporterId)) {
      return false
    }
    if (filter.priority !== undefined && card.priority !== filter.priority) return false
    if (filter.priorities !== undefined && !filter.priorities.includes(card.priority)) return false
    if (filter.locationIds !== undefined) {
      if (card.locationId === null || !filter.locationIds.includes(card.locationId)) return false
    }
    if (filter.overdueCandidate === true) {
      if (card.workStartedAt === null || card.estimateMinutes === null) return false
    }
    if (filter.blocked !== undefined && card.blocked !== filter.blocked) return false
    if (filter.waitingReason !== undefined && card.waitingReason !== filter.waitingReason) {
      return false
    }
    if (filter.overdueBefore !== undefined) {
      if (card.expectedResumeAt === null || card.expectedResumeAt >= filter.overdueBefore) {
        return false
      }
    }
    if (filter.tags !== undefined && filter.tags.length > 0) {
      const wanted = filter.tags.map((name) => name.toLowerCase())
      const tagIds = this.state.cardTags
        .filter((row) => row.cardId === card.id)
        .map((row) => row.tagId)
      const names = this.state.tags
        .filter((tag) => tagIds.includes(tag.id))
        .map((tag) => tag.name.toLowerCase())
      // Any-of: keep the card when it carries at least one of the wanted tags.
      if (!names.some((name) => wanted.includes(name))) return false
    }
    if (filter.q !== undefined) {
      const haystack = `${card.title}\n${card.description}`.toLowerCase()
      if (!haystack.includes(filter.q.toLowerCase())) return false
    }
    return true
  }

  private assertUniquePosition(card: Card): void {
    if (this.db.failNextCardPositionWrite) {
      this.db.failNextCardPositionWrite = false
      throw new DuplicatePositionError()
    }
    const duplicate = this.state.cards.some(
      (candidate) =>
        candidate.id !== card.id &&
        candidate.laneId === card.laneId &&
        candidate.position === card.position,
    )
    if (duplicate) throw new DuplicatePositionError()
  }
}

class InMemoryCommentRepository implements CommentRepository {
  private readonly state: DbState

  constructor(state: DbState) {
    this.state = state
  }

  findById(id: string): Promise<Comment | null> {
    const comment = this.state.comments.find((candidate) => candidate.id === id)
    return Promise.resolve(comment ? clone(comment) : null)
  }

  insert(comment: Comment): Promise<void> {
    this.state.comments.push(clone(comment))
    return Promise.resolve()
  }

  update(comment: Comment): Promise<void> {
    const index = this.state.comments.findIndex((candidate) => candidate.id === comment.id)
    if (index === -1) return Promise.reject(new NotFoundError('comment'))
    this.state.comments.splice(index, 1, clone(comment))
    return Promise.resolve()
  }

  listByCard(cardId: number): Promise<Comment[]> {
    return Promise.resolve(
      clone(
        this.state.comments
          .filter((comment) => comment.cardId === cardId)
          .sort((a, b) =>
            a.createdAt === b.createdAt
              ? binaryCompare(a.id, b.id)
              : binaryCompare(a.createdAt, b.createdAt),
          ),
      ),
    )
  }
}

class InMemoryAttachmentRepository implements AttachmentRepository {
  private readonly state: DbState

  constructor(state: DbState) {
    this.state = state
  }

  findById(id: string): Promise<Attachment | null> {
    const attachment = this.state.attachments.find((candidate) => candidate.id === id)
    return Promise.resolve(attachment ? clone(attachment) : null)
  }

  insert(attachment: Attachment): Promise<void> {
    this.state.attachments.push(clone(attachment))
    return Promise.resolve()
  }

  update(attachment: Attachment): Promise<void> {
    const index = this.state.attachments.findIndex((candidate) => candidate.id === attachment.id)
    if (index === -1) return Promise.reject(new NotFoundError('attachment'))
    this.state.attachments.splice(index, 1, clone(attachment))
    return Promise.resolve()
  }

  listByCard(cardId: number): Promise<Attachment[]> {
    return Promise.resolve(
      clone(
        this.state.attachments
          .filter((attachment) => attachment.cardId === cardId)
          .sort((a, b) => binaryCompare(a.createdAt, b.createdAt)),
      ),
    )
  }
}

class InMemoryUserRepository implements UserRepository {
  private readonly state: DbState

  constructor(state: DbState) {
    this.state = state
  }

  findById(id: string): Promise<User | null> {
    const user = this.state.users.find((candidate) => candidate.id === id)
    return Promise.resolve(user ? clone(user) : null)
  }
}

class InMemoryUserAccountRepository implements UserAccountRepository {
  private readonly state: DbState

  constructor(state: DbState) {
    this.state = state
  }

  private credentialsOf(user: User): UserCredentials {
    const row = this.state.passwordHashes.find((candidate) => candidate.userId === user.id)
    return { user: clone(user), passwordHash: row?.hash ?? '' }
  }

  findByEmail(email: string): Promise<UserCredentials | null> {
    const wanted = email.toLowerCase()
    const user = this.state.users.find((candidate) => candidate.email.toLowerCase() === wanted)
    return Promise.resolve(user ? this.credentialsOf(user) : null)
  }

  findBySlackUserId(slackUserId: string): Promise<UserCredentials | null> {
    const user = this.state.users.find((candidate) => candidate.slackUserId === slackUserId)
    return Promise.resolve(user ? this.credentialsOf(user) : null)
  }

  findById(id: string): Promise<UserCredentials | null> {
    const user = this.state.users.find((candidate) => candidate.id === id)
    return Promise.resolve(user ? this.credentialsOf(user) : null)
  }

  list(): Promise<User[]> {
    return Promise.resolve(clone(this.state.users))
  }

  /**
   * Mirrors the SQL adapter (docs/architecture/rest-api.md): case-insensitive
   * substring over display name + email (or an `ids` allowlist), `activeOnly`
   * / `excludeId` applied, ordered by lower(display_name) then id, limited.
   */
  search(filter: UserSearchFilter): Promise<User[]> {
    const needle = filter.q.toLowerCase()
    const idSet = filter.ids === undefined ? undefined : new Set(filter.ids)
    const matched = this.state.users.filter((user) => {
      if (filter.excludeId !== undefined && user.id === filter.excludeId) return false
      if (filter.activeOnly === true && !user.isActive) return false
      if (idSet !== undefined) return idSet.has(user.id)
      if (needle === '') return true
      return (
        user.displayName.toLowerCase().includes(needle) || user.email.toLowerCase().includes(needle)
      )
    })
    matched.sort((a, b) => {
      const byName = binaryCompare(a.displayName.toLowerCase(), b.displayName.toLowerCase())
      return byName !== 0 ? byName : binaryCompare(a.id, b.id)
    })
    return Promise.resolve(clone(matched.slice(0, filter.limit)))
  }

  countHumanUsers(excludedSystemUserId: string): Promise<number> {
    // Any status counts — deactivated rows keep first-boot setup closed.
    return Promise.resolve(
      this.state.users.filter((candidate) => candidate.id !== excludedSystemUserId).length,
    )
  }

  insert(user: User, passwordHash: string): Promise<void> {
    const wanted = user.email.toLowerCase()
    if (this.state.users.some((candidate) => candidate.email.toLowerCase() === wanted)) {
      return Promise.reject(new ConflictError('email already in use'))
    }
    this.state.users.push(clone(user))
    this.state.passwordHashes.push({ userId: user.id, hash: passwordHash })
    return Promise.resolve()
  }

  update(user: User): Promise<void> {
    const index = this.state.users.findIndex((candidate) => candidate.id === user.id)
    if (index === -1) return Promise.reject(new NotFoundError('user'))
    this.state.users.splice(index, 1, clone(user))
    return Promise.resolve()
  }

  setPassword(userId: string, passwordHash: string, mustChangePassword: boolean): Promise<void> {
    const user = this.state.users.find((candidate) => candidate.id === userId)
    if (!user) return Promise.reject(new NotFoundError('user'))
    const row = this.state.passwordHashes.find((candidate) => candidate.userId === userId)
    if (row) row.hash = passwordHash
    else this.state.passwordHashes.push({ userId, hash: passwordHash })
    user.mustChangePassword = mustChangePassword
    return Promise.resolve()
  }
}

class InMemorySessionRepository implements SessionRepository {
  private readonly state: DbState

  constructor(state: DbState) {
    this.state = state
  }

  create(session: Session): Promise<void> {
    this.state.sessions.push(clone(session))
    return Promise.resolve()
  }

  findByHash(idHash: string): Promise<Session | null> {
    const session = this.state.sessions.find((candidate) => candidate.id === idHash)
    return Promise.resolve(session ? clone(session) : null)
  }

  touch(idHash: string, lastSeenAt: string, expiresAt: string): Promise<void> {
    const session = this.state.sessions.find((candidate) => candidate.id === idHash)
    if (session) {
      session.lastSeenAt = lastSeenAt
      session.expiresAt = expiresAt
    }
    return Promise.resolve()
  }

  revoke(idHash: string): Promise<void> {
    this.retain((session) => session.id !== idHash)
    return Promise.resolve()
  }

  revokeOthersForUser(userId: string, exceptIdHash?: string): Promise<void> {
    this.retain((session) => session.userId !== userId || session.id === exceptIdHash)
    return Promise.resolve()
  }

  deleteExpired(nowIso: string): Promise<number> {
    const before = this.state.sessions.length
    this.retain((session) => session.expiresAt > nowIso)
    return Promise.resolve(before - this.state.sessions.length)
  }

  private retain(keep: (session: Session) => boolean): void {
    const kept = this.state.sessions.filter(keep)
    this.state.sessions.length = 0
    this.state.sessions.push(...kept)
  }
}

class InMemoryServiceTokenRepository implements ServiceTokenRepository {
  private readonly state: DbState

  constructor(state: DbState) {
    this.state = state
  }

  findByHash(tokenHash: string): Promise<ServiceToken | null> {
    const token = this.state.serviceTokens.find((candidate) => candidate.tokenHash === tokenHash)
    return Promise.resolve(token ? clone(token) : null)
  }

  updateLastUsed(id: string, lastUsedAt: string): Promise<void> {
    const token = this.state.serviceTokens.find((candidate) => candidate.id === id)
    if (!token) return Promise.reject(new NotFoundError('service token'))
    token.lastUsedAt = lastUsedAt
    return Promise.resolve()
  }

  list(): Promise<ServiceToken[]> {
    return Promise.resolve(
      clone([...this.state.serviceTokens].sort((a, b) => binaryCompare(b.createdAt, a.createdAt))),
    )
  }

  insert(token: ServiceToken): Promise<void> {
    if (this.state.serviceTokens.some((candidate) => candidate.tokenHash === token.tokenHash)) {
      return Promise.reject(new ConflictError('service token hash already exists'))
    }
    this.state.serviceTokens.push(clone(token))
    return Promise.resolve()
  }

  revoke(id: string, revokedAt: string): Promise<void> {
    const token = this.state.serviceTokens.find((candidate) => candidate.id === id)
    if (!token) return Promise.reject(new NotFoundError('service token'))
    token.revokedAt = token.revokedAt ?? revokedAt
    return Promise.resolve()
  }

  rotateHash(id: string, tokenHash: string): Promise<ServiceToken> {
    const token = this.state.serviceTokens.find((candidate) => candidate.id === id)
    if (!token) return Promise.reject(new NotFoundError('service token'))
    if (token.revokedAt !== null) {
      return Promise.reject(new ConflictError('service token is revoked'))
    }
    token.tokenHash = tokenHash
    return Promise.resolve(clone(token))
  }
}

class InMemoryLaneRepository implements LaneRepository {
  private readonly state: DbState

  constructor(state: DbState) {
    this.state = state
  }

  listByBoard(boardId: string): Promise<Lane[]> {
    return Promise.resolve(
      clone(
        this.state.lanes
          .filter((lane) => lane.boardId === boardId)
          .sort((a, b) => a.position - b.position),
      ),
    )
  }

  findByKey(boardId: string, key: string): Promise<Lane | null> {
    const lane = this.state.lanes.find(
      (candidate) => candidate.boardId === boardId && candidate.key === key,
    )
    return Promise.resolve(lane ? clone(lane) : null)
  }

  update(lane: Lane): Promise<void> {
    const index = this.state.lanes.findIndex((candidate) => candidate.id === lane.id)
    if (index === -1) return Promise.reject(new NotFoundError('lane'))
    this.state.lanes.splice(index, 1, clone(lane))
    return Promise.resolve()
  }
}

class InMemoryLocationRepository implements LocationRepository {
  private readonly state: DbState

  constructor(state: DbState) {
    this.state = state
  }

  findById(id: string): Promise<Location | null> {
    const location = this.state.locations.find((candidate) => candidate.id === id)
    return Promise.resolve(location ? clone(location) : null)
  }

  findByNameCi(name: string): Promise<Location | null> {
    const wanted = name.toLowerCase()
    const location = this.state.locations.find(
      (candidate) => candidate.name.toLowerCase() === wanted,
    )
    return Promise.resolve(location ? clone(location) : null)
  }

  list(): Promise<Location[]> {
    return Promise.resolve(clone(this.state.locations))
  }

  insert(location: Location): Promise<void> {
    this.state.locations.push(clone(location))
    return Promise.resolve()
  }

  update(location: Location): Promise<void> {
    const index = this.state.locations.findIndex((candidate) => candidate.id === location.id)
    if (index === -1) return Promise.reject(new NotFoundError('location'))
    this.state.locations.splice(index, 1, clone(location))
    return Promise.resolve()
  }

  /**
   * Recursive delete mirroring the real adapter: removes the whole subtree
   * rooted at `id` and clears `location_id` on every card that referenced any
   * removed node (location is optional — the card survives). NotFoundError
   * only when `id` is absent; children never make it a conflict.
   */
  delete(id: string): Promise<void> {
    if (!this.state.locations.some((candidate) => candidate.id === id)) {
      return Promise.reject(new NotFoundError('location'))
    }
    // Breadth-first collection of the subtree ids (root + all descendants).
    const subtreeIds = new Set<string>([id])
    let frontier = [id]
    while (frontier.length > 0) {
      const children = this.state.locations
        .filter((candidate) => candidate.parentId !== null && frontier.includes(candidate.parentId))
        .map((candidate) => candidate.id)
        .filter((childId) => !subtreeIds.has(childId))
      for (const childId of children) subtreeIds.add(childId)
      frontier = children
    }
    for (const card of this.state.cards) {
      if (card.locationId !== null && subtreeIds.has(card.locationId)) card.locationId = null
    }
    this.state.locations = this.state.locations.filter((candidate) => !subtreeIds.has(candidate.id))
    return Promise.resolve()
  }
}

class InMemoryTagRepository implements TagRepository {
  private readonly state: DbState

  constructor(state: DbState) {
    this.state = state
  }

  findByNameCi(name: string): Promise<Tag | null> {
    const wanted = name.toLowerCase()
    const tag = this.state.tags.find((candidate) => candidate.name.toLowerCase() === wanted)
    return Promise.resolve(tag ? clone(tag) : null)
  }

  insert(tag: Tag): Promise<void> {
    this.state.tags.push(clone(tag))
    return Promise.resolve()
  }

  listByCard(cardId: number): Promise<Tag[]> {
    const tagIds = this.state.cardTags
      .filter((row) => row.cardId === cardId)
      .map((row) => row.tagId)
    const tags = tagIds
      .map((tagId) => this.state.tags.find((tag) => tag.id === tagId))
      .filter((tag): tag is Tag => tag !== undefined)
    return Promise.resolve(clone(tags))
  }

  setCardTags(cardId: number, tagIds: string[]): Promise<void> {
    const kept = this.state.cardTags.filter((row) => row.cardId !== cardId)
    this.state.cardTags.length = 0
    this.state.cardTags.push(...kept, ...tagIds.map((tagId) => ({ cardId, tagId })))
    return Promise.resolve()
  }

  listAll(): Promise<Tag[]> {
    return Promise.resolve(
      clone([...this.state.tags].sort((a, b) => binaryCompare(a.name, b.name))),
    )
  }
}

class InMemoryPolicyRepository implements PolicyRepository {
  private readonly state: DbState

  constructor(state: DbState) {
    this.state = state
  }

  getActive(boardId: string): Promise<BoardPolicy | null> {
    const versions = this.state.policies
      .filter((policy) => policy.boardId === boardId)
      .sort((a, b) => binaryCompare(a.createdAt, b.createdAt))
    const newest = versions.at(-1)
    return Promise.resolve(newest ? clone(newest) : null)
  }

  insert(policy: BoardPolicy): Promise<void> {
    this.state.policies.push(clone(policy))
    return Promise.resolve()
  }
}

class InMemoryEventRepository implements EventRepository {
  private readonly state: DbState

  constructor(state: DbState) {
    this.state = state
  }

  append(event: CardEvent): Promise<void> {
    this.state.events.push(clone(event))
    return Promise.resolve()
  }

  listByCard(
    cardId: number,
    options?: { types?: readonly CardEventType[]; after?: CursorKey; limit?: number },
  ): Promise<CardEvent[]> {
    let events = this.state.events
      .filter((event) => event.cardId === cardId)
      .filter((event) => options?.types === undefined || options.types.includes(event.eventType))
      .sort((a, b) =>
        a.createdAt === b.createdAt
          ? binaryCompare(a.id, b.id)
          : binaryCompare(a.createdAt, b.createdAt),
      )
    const after = options?.after
    if (after !== undefined) {
      // Event cursors carry the UUID event id; String() is a no-op on it.
      const afterId = String(after.id)
      events = events.filter(
        (event) =>
          event.createdAt > after.createdAt ||
          (event.createdAt === after.createdAt && event.id > afterId),
      )
    }
    if (options?.limit !== undefined) events = events.slice(0, options.limit)
    return Promise.resolve(clone(events))
  }

  async listLatestByCard(
    cardId: number,
    limit: number,
    types?: readonly CardEventType[],
  ): Promise<CardEvent[]> {
    const events = await this.listByCard(cardId, types === undefined ? {} : { types })
    return events.slice(-limit).reverse()
  }

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
  ): Promise<CardEvent[]> {
    let events = this.state.events
      .filter((event) => event.createdAt >= sinceIso)
      .filter((event) => options?.types === undefined || options.types.includes(event.eventType))
      .filter((event) => options?.cardId === undefined || event.cardId === options.cardId)
      .filter((event) => options?.actorKind === undefined || event.actorKind === options.actorKind)
      .filter(
        (event) =>
          options?.actorIds === undefined ||
          (event.actorId !== null && options.actorIds.includes(event.actorId)),
      )
      // Newest-first (createdAt DESC, id DESC) — mirrors the SQL adapter.
      .sort((a, b) =>
        a.createdAt === b.createdAt
          ? binaryCompare(b.id, a.id)
          : binaryCompare(b.createdAt, a.createdAt),
      )
    const after = options?.after
    if (after !== undefined) {
      // Event cursors carry the UUID event id; String() is a no-op on it.
      const afterId = String(after.id)
      events = events.filter(
        (event) =>
          event.createdAt < after.createdAt ||
          (event.createdAt === after.createdAt && event.id < afterId),
      )
    }
    if (options?.limit !== undefined) events = events.slice(0, options.limit)
    return Promise.resolve(clone(events))
  }
}

class InMemoryFilterPresetRepository implements FilterPresetRepository {
  private readonly state: DbState

  constructor(state: DbState) {
    this.state = state
  }

  listVisibleTo(userId: string): Promise<FilterPreset[]> {
    return Promise.resolve(
      clone(
        this.state.filterPresets
          // Own presets plus every team-shared one (mirrors the SQL OR).
          .filter((preset) => preset.ownerId === userId || preset.shared)
          // Newest-first (createdAt DESC, id DESC) — mirrors the SQL adapter.
          .sort((a, b) =>
            a.createdAt === b.createdAt
              ? binaryCompare(b.id, a.id)
              : binaryCompare(b.createdAt, a.createdAt),
          ),
      ),
    )
  }

  findByIdForOwner(id: string, ownerId: string): Promise<FilterPreset | null> {
    const preset = this.state.filterPresets.find(
      (candidate) => candidate.id === id && candidate.ownerId === ownerId,
    )
    return Promise.resolve(preset ? clone(preset) : null)
  }

  insert(preset: FilterPreset): Promise<void> {
    this.state.filterPresets.push(clone(preset))
    return Promise.resolve()
  }

  update(preset: FilterPreset): Promise<void> {
    const index = this.state.filterPresets.findIndex(
      (candidate) => candidate.id === preset.id && candidate.ownerId === preset.ownerId,
    )
    if (index === -1) return Promise.reject(new NotFoundError('filter preset'))
    this.state.filterPresets.splice(index, 1, clone(preset))
    return Promise.resolve()
  }

  delete(id: string, ownerId: string): Promise<void> {
    const index = this.state.filterPresets.findIndex(
      (candidate) => candidate.id === id && candidate.ownerId === ownerId,
    )
    if (index === -1) return Promise.reject(new NotFoundError('filter preset'))
    this.state.filterPresets.splice(index, 1)
    return Promise.resolve()
  }
}

class InMemoryCardRelationRepository implements CardRelationRepository {
  private readonly state: DbState

  constructor(state: DbState) {
    this.state = state
  }

  listByCard(cardId: number): Promise<CardRelation[]> {
    return Promise.resolve(
      clone(
        this.state.cardRelations
          .filter((relation) => relation.fromCardId === cardId || relation.toCardId === cardId)
          // Newest-first (createdAt DESC, id DESC) — mirrors the SQL adapter.
          .sort((a, b) =>
            a.createdAt === b.createdAt
              ? binaryCompare(b.id, a.id)
              : binaryCompare(b.createdAt, a.createdAt),
          ),
      ),
    )
  }

  findById(id: string): Promise<CardRelation | null> {
    const relation = this.state.cardRelations.find((candidate) => candidate.id === id)
    return Promise.resolve(relation ? clone(relation) : null)
  }

  exists(fromCardId: number, toCardId: number, type: RelationType): Promise<boolean> {
    return Promise.resolve(
      this.state.cardRelations.some(
        (relation) =>
          relation.fromCardId === fromCardId &&
          relation.toCardId === toCardId &&
          relation.type === type,
      ),
    )
  }

  insert(relation: CardRelation): Promise<void> {
    this.state.cardRelations.push(clone(relation))
    return Promise.resolve()
  }

  delete(id: string): Promise<void> {
    const index = this.state.cardRelations.findIndex((candidate) => candidate.id === id)
    if (index !== -1) this.state.cardRelations.splice(index, 1)
    return Promise.resolve()
  }
}
