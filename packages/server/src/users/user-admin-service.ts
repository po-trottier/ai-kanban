import { randomBytes } from 'node:crypto'
import {
  createUserInputSchema,
  DEFAULT_TIMEZONE,
  ensurePermission,
  NotFoundError,
  updateUserInputSchema,
  type Actor,
  type Clock,
  type EventBus,
  type IdGenerator,
  type UnitOfWork,
  type User,
} from '@rivian-kanban/core'
import { loadActivePolicy, manageUsersRoleKeys, roleExists } from '../authz.ts'
import { LastActiveAdminError, RequestValidationError } from '../errors.ts'
import { type PasswordHasher } from '../auth/password-hasher.ts'

/**
 * Admin users CRUD (docs/architecture/rest-api.md#auth--users). Gated by the
 * active policy's `manageUsers` permission (ADR-013 — roles are data). Assigned
 * roles are validated against the defined roles, and the last active account
 * that can still manage users can never be demoted or deactivated.
 */

export interface UserAdminServiceDeps {
  uow: UnitOfWork
  clock: Clock
  ids: IdGenerator
  hasher: PasswordHasher
  eventBus: EventBus
  boardId: string
  /** The structural-seed automation user — excluded from pickers and admin counts. */
  systemUserId: string
}

export interface UserWithTempPassword {
  user: User
  /** One-time temp password — returned exactly once, never persisted raw. */
  tempPassword?: string
}

/** 16-char base64url one-time password (satisfies the 12-char minimum). */
function generateTempPassword(): string {
  return randomBytes(12).toString('base64url')
}

export class UserAdminService {
  private readonly deps: UserAdminServiceDeps

  constructor(deps: UserAdminServiceDeps) {
    this.deps = deps
  }

  /** Active users for pickers (id/name/role), automation user excluded. */
  async listActive(): Promise<User[]> {
    const users = await this.deps.uow.read((tx) => tx.userAccounts.list())
    return users.filter((user) => user.isActive && user.id !== this.deps.systemUserId)
  }

  /**
   * Creates a user with a one-time temp password (`must_change_password`
   * set). Duplicate emails are a 409 conflict.
   *
   * Policy checks: `manageUsers` grant. The assigned role must be a role
   * defined in the active policy (else 400). Publishes `user.updated`.
   */
  async create(actor: Actor, rawInput: unknown): Promise<Required<UserWithTempPassword>> {
    const input = createUserInputSchema.parse(rawInput)
    const tempPassword = generateTempPassword()
    const passwordHash = await this.deps.hasher.hash(tempPassword)
    const user: User = {
      id: this.deps.ids.newId(),
      email: input.email.toLowerCase(),
      displayName: input.displayName,
      role: input.role,
      mustChangePassword: true,
      slackUserId: null,
      isActive: true,
      // Admin-created accounts default to PST (no browser to auto-detect from);
      // the user re-picks their own zone from account settings after signing in.
      timezone: DEFAULT_TIMEZONE,
      createdAt: this.deps.clock.now().toISOString(),
    }
    await this.deps.uow.run(async (tx) => {
      const policy = await loadActivePolicy(tx, this.deps.boardId)
      ensurePermission(actor, 'manageUsers', policy)
      if (!roleExists(policy, input.role)) {
        throw new RequestValidationError('role', `unknown role "${input.role}"`)
      }
      await tx.userAccounts.insert(user, passwordHash)
    })
    this.deps.eventBus.publish({ type: 'user.updated' })
    return { user, tempPassword }
  }

  /**
   * Updates profile/role/active state and optionally resets the password
   * (fresh one-time temp password returned once). The last active user whose
   * role grants `manageUsers` (the admin-equivalent set, computed from the
   * active policy) can never be demoted below it or deactivated (409, named
   * rule). Role changes, deactivation, and password resets revoke the user's
   * sessions immediately (docs/architecture/security.md#authentication).
   *
   * Policy checks: `manageUsers` grant. An assigned role must be defined in the
   * active policy (else 400). Publishes `user.updated`.
   */
  async update(actor: Actor, userId: string, rawInput: unknown): Promise<UserWithTempPassword> {
    const input = updateUserInputSchema.parse(rawInput)
    const tempPassword = input.resetPassword === true ? generateTempPassword() : undefined
    const passwordHash =
      tempPassword === undefined ? undefined : await this.deps.hasher.hash(tempPassword)

    const user = await this.deps.uow.run(async (tx) => {
      const policy = await loadActivePolicy(tx, this.deps.boardId)
      ensurePermission(actor, 'manageUsers', policy)
      if (input.role !== undefined && !roleExists(policy, input.role)) {
        throw new RequestValidationError('role', `unknown role "${input.role}"`)
      }
      const found = await tx.users.findById(userId)
      if (found === null) throw new NotFoundError('user')

      // Admin-equivalent = any role that grants manageUsers. Protect the last
      // active one from losing that capability (demotion to a role without it,
      // or deactivation) so an instance can never be locked out of user admin.
      const adminRoles = manageUsersRoleKeys(policy)
      const demotesAdmin = input.role !== undefined && !adminRoles.has(input.role)
      const deactivates = input.isActive === false
      if (adminRoles.has(found.role) && found.isActive && (demotesAdmin || deactivates)) {
        const all = await tx.userAccounts.list()
        const otherActiveAdmins = all.filter(
          (candidate) =>
            adminRoles.has(candidate.role) &&
            candidate.isActive &&
            candidate.id !== found.id &&
            candidate.id !== this.deps.systemUserId,
        )
        if (otherActiveAdmins.length === 0) throw new LastActiveAdminError()
      }

      const updated: User = {
        ...found,
        displayName: input.displayName ?? found.displayName,
        role: input.role ?? found.role,
        isActive: input.isActive ?? found.isActive,
        mustChangePassword: passwordHash === undefined ? found.mustChangePassword : true,
      }
      await tx.userAccounts.update(updated)
      if (passwordHash !== undefined) {
        await tx.userAccounts.setPassword(userId, passwordHash, true)
      }

      const roleChanged = updated.role !== found.role
      const deactivated = found.isActive && !updated.isActive
      if (roleChanged || deactivated || passwordHash !== undefined) {
        await tx.sessions.revokeOthersForUser(userId)
      }
      return updated
    })
    this.deps.eventBus.publish({ type: 'user.updated' })
    return tempPassword === undefined ? { user } : { user, tempPassword }
  }
}
