import { createHash, randomBytes } from 'node:crypto'
import { type Clock, type Session, type UnitOfWork, type User } from '@rivian-kanban/core'
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

  constructor(deps: AuthServiceDeps) {
    this.deps = deps
  }

  /**
   * Email+password → fresh session (never reuses an id — anti-fixation).
   * Uniform failures: unknown email verifies a static dummy hash so timing
   * does not enumerate users; inactive accounts fail identically. Per-account
   * exponential backoff throttles repeated failures (429 before any lookup).
   */
  async login(email: string, password: string): Promise<LoginResult> {
    const { uow, clock, hasher, backoff } = this.deps
    const waitMs = backoff.retryAfterMs(email)
    if (waitMs > 0) throw new BackoffActiveError(Math.ceil(waitMs / 1000))

    const credentials = await uow.run((tx) => tx.userAccounts.findByEmail(email))
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

    const rawSessionId = randomBytes(32).toString('base64url')
    const now = clock.now()
    const session: Session = {
      id: sessionHashOf(rawSessionId),
      userId: credentials.user.id,
      createdAt: now.toISOString(),
      expiresAt: foldedExpiry(now.toISOString(), now),
      lastSeenAt: now.toISOString(),
    }
    await uow.run((tx) => tx.sessions.create(session))
    return { user: credentials.user, rawSessionId }
  }

  /**
   * Resolves a raw cookie id to its live user, or null (expired, revoked,
   * unknown, or deactivated — a deactivated user's session is revoked on
   * sight). Slides the expiry, throttled to once per 5 minutes.
   */
  async authenticate(rawSessionId: string): Promise<User | null> {
    const { uow, clock } = this.deps
    const idHash = sessionHashOf(rawSessionId)
    const now = clock.now()
    const nowIso = now.toISOString()
    return uow.run(async (tx) => {
      const session = await tx.sessions.findByHash(idHash)
      if (session === null || session.expiresAt <= nowIso) return null
      const user = await tx.users.findById(session.userId)
      if (user === null) return null
      if (!user.isActive) {
        await tx.sessions.revoke(idHash)
        return null
      }
      if (now.getTime() - new Date(session.lastSeenAt).getTime() >= SESSION_TOUCH_THROTTLE_MS) {
        await tx.sessions.touch(idHash, nowIso, foldedExpiry(session.createdAt, now))
      }
      return user
    })
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
   */
  async changePassword(
    userId: string,
    rawSessionId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const { uow, hasher } = this.deps
    const credentials = await uow.run((tx) => tx.userAccounts.findById(userId))
    if (credentials === null) throw new CurrentPasswordMismatchError()
    const verified = await hasher.verify(credentials.passwordHash, currentPassword)
    if (!verified) throw new CurrentPasswordMismatchError()

    const violation = passwordPolicyViolation(newPassword)
    if (violation !== null) throw new PasswordPolicyError(violation)

    const newHash = await hasher.hash(newPassword)
    const keepHash = sessionHashOf(rawSessionId)
    await uow.run(async (tx) => {
      await tx.userAccounts.setPassword(userId, newHash, false)
      await tx.sessions.revokeOthersForUser(userId, keepHash)
    })
  }

  /** Purges expired sessions; the daily job (scheduler task) calls this. */
  async deleteExpiredSessions(): Promise<number> {
    const nowIso = this.deps.clock.now().toISOString()
    return this.deps.uow.run((tx) => tx.sessions.deleteExpired(nowIso))
  }
}
