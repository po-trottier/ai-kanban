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
import { type BoardPolicy } from '../domain/policy.ts'
import {
  type AttachmentRepository,
  type CardQueryFilter,
  type CardRepository,
  type CommentRepository,
  type EventRepository,
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
} from '../ports/repositories.ts'

/**
 * Hand-written in-memory fake of the persistence ports (docs/dev/testing.md).
 * The UnitOfWork is honest: `run` works on a deep copy of the committed state
 * and swaps it in only on success — mutations inside a failed transaction
 * never leak. The card repository enforces UNIQUE(laneId, position) and
 * throws DuplicatePositionError like the real backstop.
 */

interface CardTagRow {
  cardId: string
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

  seedCardTag(cardId: string, tagId: string): void {
    this.state.cardTags.push({ cardId, tagId })
  }

  seedPolicy(policy: BoardPolicy): void {
    this.state.policies.push(clone(policy))
  }

  getCard(id: string): Card {
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
  eventsFor(cardId: string): CardEvent[] {
    return clone(this.state.events.filter((event) => event.cardId === cardId))
  }

  /** Committed tag names for a card, in card_tags order. */
  tagNamesFor(cardId: string): string[] {
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

  findById(id: string): Promise<Card | null> {
    const card = this.state.cards.find((candidate) => candidate.id === id)
    return Promise.resolve(card ? clone(card) : null)
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

  listByLane(laneId: string): Promise<Card[]> {
    return Promise.resolve(
      clone(
        this.state.cards
          .filter((card) => card.laneId === laneId)
          .sort((a, b) => binaryCompare(a.position, b.position)),
      ),
    )
  }

  query(filter: CardQueryFilter, page?: { after?: CursorKey; limit?: number }): Promise<Card[]> {
    let cards = this.state.cards
      .filter((card) => this.matches(card, filter))
      .sort((a, b) =>
        a.createdAt === b.createdAt
          ? binaryCompare(b.id, a.id)
          : binaryCompare(b.createdAt, a.createdAt),
      )
    const after = page?.after
    if (after !== undefined) {
      cards = cards.filter(
        (card) =>
          card.createdAt < after.createdAt ||
          (card.createdAt === after.createdAt && card.id < after.id),
      )
    }
    if (page?.limit !== undefined) cards = cards.slice(0, page.limit)
    return Promise.resolve(clone(cards))
  }

  private matches(card: Card, filter: CardQueryFilter): boolean {
    if (filter.includeArchived !== true && card.archivedAt !== null) return false
    if (filter.laneId !== undefined && card.laneId !== filter.laneId) return false
    if (filter.assigneeId !== undefined && card.assigneeId !== filter.assigneeId) return false
    if (filter.reporterId !== undefined && card.reporterId !== filter.reporterId) return false
    if (filter.priority !== undefined && card.priority !== filter.priority) return false
    if (filter.blocked !== undefined && card.blocked !== filter.blocked) return false
    if (filter.waitingReason !== undefined && card.waitingReason !== filter.waitingReason) {
      return false
    }
    if (filter.overdueBefore !== undefined) {
      if (card.expectedResumeAt === null || card.expectedResumeAt >= filter.overdueBefore) {
        return false
      }
    }
    if (filter.tag !== undefined) {
      const wanted = filter.tag.toLowerCase()
      const tagIds = this.state.cardTags
        .filter((row) => row.cardId === card.id)
        .map((row) => row.tagId)
      const names = this.state.tags
        .filter((tag) => tagIds.includes(tag.id))
        .map((tag) => tag.name.toLowerCase())
      if (!names.includes(wanted)) return false
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

  listByCard(cardId: string): Promise<Comment[]> {
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

  listByCard(cardId: string): Promise<Attachment[]> {
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

  findById(id: string): Promise<UserCredentials | null> {
    const user = this.state.users.find((candidate) => candidate.id === id)
    return Promise.resolve(user ? this.credentialsOf(user) : null)
  }

  list(): Promise<User[]> {
    return Promise.resolve(clone(this.state.users))
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
    this.state.serviceTokens.push(clone(token))
    return Promise.resolve()
  }

  revoke(id: string, revokedAt: string): Promise<void> {
    const token = this.state.serviceTokens.find((candidate) => candidate.id === id)
    if (!token) return Promise.reject(new NotFoundError('service token'))
    token.revokedAt = token.revokedAt ?? revokedAt
    return Promise.resolve()
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

  delete(id: string): Promise<void> {
    const index = this.state.locations.findIndex((candidate) => candidate.id === id)
    if (index === -1) return Promise.reject(new NotFoundError('location'))
    const referenced =
      this.state.locations.some((candidate) => candidate.parentId === id) ||
      this.state.cards.some((card) => card.locationId === id)
    if (referenced) return Promise.reject(new ConflictError('location is still referenced'))
    this.state.locations.splice(index, 1)
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

  listByCard(cardId: string): Promise<Tag[]> {
    const tagIds = this.state.cardTags
      .filter((row) => row.cardId === cardId)
      .map((row) => row.tagId)
    const tags = tagIds
      .map((tagId) => this.state.tags.find((tag) => tag.id === tagId))
      .filter((tag): tag is Tag => tag !== undefined)
    return Promise.resolve(clone(tags))
  }

  setCardTags(cardId: string, tagIds: string[]): Promise<void> {
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
    cardId: string,
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
      events = events.filter(
        (event) =>
          event.createdAt > after.createdAt ||
          (event.createdAt === after.createdAt && event.id > after.id),
      )
    }
    if (options?.limit !== undefined) events = events.slice(0, options.limit)
    return Promise.resolve(clone(events))
  }

  async listLatestByCard(cardId: string, limit: number): Promise<CardEvent[]> {
    const events = await this.listByCard(cardId)
    return events.slice(-limit).reverse()
  }
}
