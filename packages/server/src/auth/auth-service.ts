import { createHash, randomBytes } from 'node:crypto'
import {
  NotFoundError,
  updateProfileInputSchema,
  type Clock,
  type Session,
  type UnitOfWork,
  type User,
} from '@rivian-kanban/core'
import {
  BackoffActiveError,
  CurrentPasswordMismatchError,
  InvalidCredentialsError,
  PasswordPolicyError,
} from '../errors.ts'
import { type LoginBackoff } from './backoff.ts'
import { type PasswordHasher } from './password-hasher.ts'
import { passwordPolicyViolation } from './password-policy.ts'

/**
 * Session lifecycle constants (ADR-009, docs/architecture/security.md):
 * sliding expiry — 7 days idle, 30 days absolute; `last_seen_at` writes
 * throttled to once per 5 minutes.
 */
const SESSION_IDLE_MS = 7 * 86_400_000
const SESSION_ABSOLUTE_MS = 30 * 86_400_000
const SESSION_TOUCH_THROTTLE_MS = 5 * 60_000

/** sha256 hex of a raw session id — the only form that ever touches the db. */
export function sessionHashOf(rawSessionId: string): string {
  return createHash('sha256').update(rawSessionId).digest('hex')
}

/** Folded expiry: `min(now + idle, createdAt + absolute)` (one comparison at read). */
function foldedExpiry(createdAtIso: string, now: Date): string {
  const absolute = new Date(createdAtIso).getTime() + SESSION_ABSOLUTE_MS
  return new Date(Math.min(now.getTime() + SESSION_IDLE_MS, absolute)).toISOString()
}

/**
 * Mints a fresh 256-bit session for the user — never reuses an id
 * (anti-fixation). Login and first-boot setup issue sessions through this
 * one code path; callers persist the returned row themselves so setup can
 * commit it atomically with the user insert.
 */
export function mintSession(userId: string, now: Date): { rawSessionId: string; session: Session } {
  const rawSessionId = randomBytes(32).toString('base64url')
  const nowIso = now.toISOString()
  return {
    rawSessionId,
    session: {
      id: sessionHashOf(rawSessionId),
      userId,
      createdAt: nowIso,
      expiresAt: foldedExpiry(nowIso, now),
      lastSeenAt: nowIso,
    },
  }
}

export interface AuthServiceDeps {
  uow: UnitOfWork
  clock: Clock
  hasher: PasswordHasher
  backoff: LoginBackoff
}

export interface LoginResult {
  user: User
  /** Base64url 256-bit session id — cookie-only; never stored or logged. */
  rawSessionId: string
}

/**
 * The password/session handler family (ADR-009): the only component that
 * knows about passwords — OIDC later replaces exactly this surface. argon2
 * work happens OUTSIDE the unit of work (no real async I/O inside a
 * transaction — see SqliteUnitOfWork's invariant).
 */
export class AuthService {
  private readonly deps: AuthServiceDeps
  /**
   * Per-account attempt serialization. The backoff alone is check-then-record
   * with the ~50 ms argon2 verify awaited in between, so K simultaneous
   * guesses for one email (distributed attacker, each IP within its own rate
   * limit) would all read `retryAfterMs == 0` before any failure is recorded —
   * bursts would bypass the control the backoff exists for. Queueing attempts
   * per email closes that TOCTOU: each attempt starts only after the previous
   * one recorded its outcome, so the second guess of a burst sees the first
   * failure and gets 429. Entries are removed as soon as the queue drains, so
   * the map is bounded by in-flight logins (themselves rate-limited).
   */
  private readonly loginQueues = new Map<string, Promise<void>>()

  constructor(deps: AuthServiceDeps) {
    this.deps = deps
  }

  /**
   * Email+password → fresh session (never reuses an id — anti-fixation).
   * Uniform failures: unknown email verifies a static dummy hash so timing
   * does not enumerate users; inactive accounts fail identically. Per-account
   * exponential backoff throttles repeated failures (429 before any lookup),
   * with concurrent attempts for one account serialized (see loginQueues).
   */
  login(email: string, password: string): Promise<LoginResult> {
    const account = email.toLowerCase()
    const prior = this.loginQueues.get(account) ?? Promise.resolve()
    const attempt = prior.then(() => this.attemptLogin(email, password))
    const settled = attempt.then(
      () => undefined,
      () => undefined,
    )
    this.loginQueues.set(account, settled)
    void settled.then(() => {
      if (this.loginQueues.get(account) === settled) this.loginQueues.delete(account)
    })
    return attempt
  }

  private async attemptLogin(email: string, password: string): Promise<LoginResult> {
    const { uow, clock, hasher, backoff } = this.deps
    const waitMs = backoff.retryAfterMs(email)
    if (waitMs > 0) throw new BackoffActiveError(Math.ceil(waitMs / 1000))

    const credentials = await uow.read((tx) => tx.userAccounts.findByEmail(email))
    if (credentials === null) {
      await hasher.verifyDummy(password)
      backoff.recordFailure(email)
      throw new InvalidCredentialsError()
    }
    const verified = await hasher.verify(credentials.passwordHash, password)
    if (!verified || !credentials.user.isActive) {
      backoff.recordFailure(email)
      throw new InvalidCredentialsError()
    }
    backoff.reset(email)

    const { rawSessionId, session } = mintSession(credentials.user.id, clock.now())
    await uow.run((tx) => tx.sessions.create(session))
    return { user: credentials.user, rawSessionId }
  }

  /**
   * Resolves a raw cookie id to its live user, or null (expired, revoked,
   * unknown, or deactivated — a deactivated user's session is revoked on
   * sight). Slides the expiry, throttled to once per 5 minutes.
   *
   * Runs on the read-only path: this executes on EVERY authenticated request,
   * so it must never queue behind writers. Only the throttled touch (and the
   * revoke-on-sight of a deactivated user) opens a write unit of work — both
   * are idempotent, so losing the read snapshot's atomicity is harmless.
   */
  async authenticate(rawSessionId: string): Promise<User | null> {
    const { uow, clock } = this.deps
    const idHash = sessionHashOf(rawSessionId)
    const now = clock.now()
    const nowIso = now.toISOString()
    const resolved = await uow.read(async (tx) => {
      const session = await tx.sessions.findByHash(idHash)
      if (session === null || session.expiresAt <= nowIso) return null
      const user = await tx.users.findById(session.userId)
      if (user === null) return null
      return { session, user }
    })
    if (resolved === null) return null
    const { session, user } = resolved
    if (!user.isActive) {
      await uow.run((tx) => tx.sessions.revoke(idHash))
      return null
    }
    if (now.getTime() - new Date(session.lastSeenAt).getTime() >= SESSION_TOUCH_THROTTLE_MS) {
      // Idempotent bookkeeping, deliberately NOT awaited: authenticate() runs
      // on every request, and awaiting the touch would queue read-request
      // latency behind the single-writer FIFO (a failed touch only delays the
      // next slide by one throttle window).
      void uow
        .run((tx) => tx.sessions.touch(idHash, nowIso, foldedExpiry(session.createdAt, now)))
        .catch(() => {
          // Intentionally ignored — see above.
        })
    }
    return user
  }

  /** Destroys the session (idempotent). */
  async logout(rawSessionId: string): Promise<void> {
    const idHash = sessionHashOf(rawSessionId)
    await this.deps.uow.run((tx) => tx.sessions.revoke(idHash))
  }

  /**
   * Verifies the current password, enforces the policy on the new one,
   * replaces the hash, clears `must_change_password`, and revokes every
   * other session of the user (docs/architecture/rest-api.md#auth--users).
   *
   * The current-password check shares login's per-account backoff (keyed on
   * the email): this is the second password-verification surface, and without
   * it a session-holding attacker (hijacked/kiosk-left session) could guess
   * the account password here without ever tripping the login control. No
   * attempt queue like login's — the endpoint already requires an
   * authenticated session, so the burst-TOCTOU window is not worth the
   * serialization machinery.
   */
  async changePassword(
    userId: string,
    rawSessionId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const { uow, hasher, backoff } = this.deps
    const credentials = await uow.read((tx) => tx.userAccounts.findById(userId))
    if (credentials === null) throw new CurrentPasswordMismatchError()
    const waitMs = backoff.retryAfterMs(credentials.user.email)
    if (waitMs > 0) throw new BackoffActiveError(Math.ceil(waitMs / 1000))
    const verified = await hasher.verify(credentials.passwordHash, currentPassword)
    if (!verified) {
      backoff.recordFailure(credentials.user.email)
      throw new CurrentPasswordMismatchError()
    }
    backoff.reset(credentials.user.email)

    const violation = passwordPolicyViolation(newPassword)
    if (violation !== null) throw new PasswordPolicyError(violation)

    const newHash = await hasher.hash(newPassword)
    const keepHash = sessionHashOf(rawSessionId)
    await uow.run(async (tx) => {
      await tx.userAccounts.setPassword(userId, newHash, false)
      await tx.sessions.revokeOthersForUser(userId, keepHash)
    })
  }

  /**
   * Self-service profile update: the authenticated user changes their OWN
   * display preferences (time zone + theme). Scoped to the caller's own row —
   * the route passes `request.authUser.id`, never a client-supplied id — so
   * there is no admin check and no IDOR surface. The input schema is a
   * strictObject of only the display fields, so role/active/email can never be
   * smuggled in (no privilege escalation). Touches no password/session state,
   * so unlike the admin update it never revokes sessions.
   */
  async updateProfile(userId: string, rawInput: unknown): Promise<User> {
    const input = updateProfileInputSchema.parse(rawInput)
    return this.deps.uow.run(async (tx) => {
      const found = await tx.users.findById(userId)
      if (found === null) throw new NotFoundError('user')
      const updated: User = { ...found, timezone: input.timezone, theme: input.theme }
      await tx.userAccounts.update(updated)
      return updated
    })
  }

  /** Purges expired sessions; the daily job (scheduler task) calls this. */
  async deleteExpiredSessions(): Promise<number> {
    const nowIso = this.deps.clock.now().toISOString()
    return this.deps.uow.run((tx) => tx.sessions.deleteExpired(nowIso))
  }
}
