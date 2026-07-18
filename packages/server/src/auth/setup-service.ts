import {
  setupAdminInputSchema,
  type Clock,
  type IdGenerator,
  type UnitOfWork,
  type User,
} from '@rivian-kanban/core'
import { PasswordPolicyError, SetupAlreadyCompleteError } from '../errors.ts'
import { mintSession, type LoginResult } from './auth-service.ts'
import { type PasswordHasher } from './password-hasher.ts'
import { passwordPolicyViolation } from './password-policy.ts'

/**
 * First-boot setup (docs/architecture/rest-api.md#auth--users,
 * docs/architecture/deployment.md#bootstrap): while ZERO non-system users
 * exist, `POST /setup` creates the initial admin and signs them in. The
 * surface hard-disables itself: users of ANY status count (deactivating
 * everyone never reopens it — break-glass recovery stays the create-admin
 * CLI), and the zero-check + insert commit in one unit of work so concurrent
 * submissions cannot both win.
 */

export interface SetupServiceDeps {
  uow: UnitOfWork
  clock: Clock
  ids: IdGenerator
  hasher: PasswordHasher
  /** The structural-seed automation user — never counts as a human account. */
  systemUserId: string
}

export class SetupService {
  private readonly deps: SetupServiceDeps

  constructor(deps: SetupServiceDeps) {
    this.deps = deps
  }

  /** True while zero non-system users exist (`GET /setup`). */
  async isRequired(): Promise<boolean> {
    const humans = await this.deps.uow.read((tx) =>
      tx.userAccounts.countHumanUsers(this.deps.systemUserId),
    )
    return humans === 0
  }

  /**
   * Creates the first admin — active, `must_change_password` clear (they just
   * chose the password) — and mints a session through login's code path. The
   * password rides the SAME policy as change-password. Throws
   * SetupAlreadyCompleteError (409) once any non-system user exists.
   */
  async createFirstAdmin(rawInput: unknown): Promise<LoginResult> {
    const { uow, clock, ids, hasher, systemUserId } = this.deps
    const input = setupAdminInputSchema.parse(rawInput)
    const violation = passwordPolicyViolation(input.password)
    if (violation !== null) throw new PasswordPolicyError(violation)

    // argon2 runs OUTSIDE the unit of work (SqliteUnitOfWork invariant: no
    // real async I/O inside a transaction). Wasted work when setup already
    // completed — bounded by the shared login rate bucket.
    const passwordHash = await hasher.hash(input.password)
    const now = clock.now()
    const user: User = {
      id: ids.newId(),
      email: input.email.toLowerCase(),
      displayName: input.displayName,
      role: 'admin',
      mustChangePassword: false,
      slackUserId: null,
      isActive: true,
      timezone: input.timezone,
      theme: input.theme,
      createdAt: now.toISOString(),
    }
    const { rawSessionId, session } = mintSession(user.id, now)

    // HARD GUARD: the zero-users check and the insert commit atomically —
    // the loser of a concurrent race sees the winner's row and gets the 409.
    await uow.run(async (tx) => {
      const humans = await tx.userAccounts.countHumanUsers(systemUserId)
      if (humans > 0) throw new SetupAlreadyCompleteError()
      await tx.userAccounts.insert(user, passwordHash)
      await tx.sessions.create(session)
    })
    return { user, rawSessionId }
  }
}
