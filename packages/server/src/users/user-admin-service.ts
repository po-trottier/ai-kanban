import { randomBytes } from 'node:crypto'
import {
  ADMIN_ONLY_RULE,
  NotFoundError,
  PolicyDeniedError,
  roleSchema,
  type Actor,
  type Clock,
  type EventBus,
  type IdGenerator,
  type UnitOfWork,
  type User,
} from '@rivian-kanban/core'
import { z } from 'zod'
import { LastActiveAdminError } from '../errors.ts'
import { type PasswordHasher } from '../auth/password-hasher.ts'

/**
 * Admin users CRUD (docs/architecture/rest-api.md#auth--users). The admin
 * surface is always role-restricted — it is where permissions are configured
 * (ADR-013) — so the check is a fixed identity rule, not the policy document.
 */

export const createUserInputSchema = z.strictObject({
  email: z.email().max(254),
  displayName: z.string().trim().min(1).max(100),
  role: roleSchema,
})

export const updateUserInputSchema = z
  .strictObject({
    displayName: z.string().trim().min(1).max(100).optional(),
    role: roleSchema.optional(),
    isActive: z.boolean().optional(),
    /** Issues a fresh one-time temp password (shown once in the response). */
    resetPassword: z.literal(true).optional(),
  })
  .refine((input) => Object.keys(input).length > 0, { message: 'no fields to update' })

export interface UserAdminServiceDeps {
  uow: UnitOfWork
  clock: Clock
  ids: IdGenerator
  hasher: PasswordHasher
  eventBus: EventBus
  /** The structural-seed automation user — excluded from pickers and admin counts. */
  systemUserId: string
}

export interface UserWithTempPassword {
  user: User
  /** One-time temp password — returned exactly once, never persisted raw. */
  tempPassword?: string
}

function requireAdmin(actor: Actor): void {
  if (actor.role !== 'admin') throw new PolicyDeniedError(ADMIN_ONLY_RULE)
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
    const users = await this.deps.uow.run((tx) => tx.userAccounts.list())
    return users.filter((user) => user.isActive && user.id !== this.deps.systemUserId)
  }

  /**
   * Creates a user with a one-time temp password (`must_change_password`
   * set). Duplicate emails are a 409 conflict.
   *
   * Policy checks: admin only (always-on). Publishes `user.updated`.
   */
  async create(actor: Actor, rawInput: unknown): Promise<Required<UserWithTempPassword>> {
    requireAdmin(actor)
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
      createdAt: this.deps.clock.now().toISOString(),
    }
    await this.deps.uow.run((tx) => tx.userAccounts.insert(user, passwordHash))
    this.deps.eventBus.publish({ type: 'user.updated' })
    return { user, tempPassword }
  }

  /**
   * Updates profile/role/active state and optionally resets the password
   * (fresh one-time temp password returned once). The last active admin can
   * never be demoted or deactivated (409, named rule). Role changes,
   * deactivation, and password resets revoke the user's sessions immediately
   * (docs/architecture/security.md#authentication).
   *
   * Policy checks: admin only (always-on). Publishes `user.updated`.
   */
  async update(actor: Actor, userId: string, rawInput: unknown): Promise<UserWithTempPassword> {
    requireAdmin(actor)
    const input = updateUserInputSchema.parse(rawInput)
    const tempPassword = input.resetPassword === true ? generateTempPassword() : undefined
    const passwordHash =
      tempPassword === undefined ? undefined : await this.deps.hasher.hash(tempPassword)

    const user = await this.deps.uow.run(async (tx) => {
      const found = await tx.users.findById(userId)
      if (found === null) throw new NotFoundError('user')

      const demotesAdmin = input.role !== undefined && input.role !== 'admin'
      const deactivates = input.isActive === false
      if (found.role === 'admin' && found.isActive && (demotesAdmin || deactivates)) {
        const all = await tx.userAccounts.list()
        const otherActiveAdmins = all.filter(
          (candidate) =>
            candidate.role === 'admin' &&
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
