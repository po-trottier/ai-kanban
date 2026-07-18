import { randomBytes } from 'node:crypto'
import {
  DEFAULT_TIMEZONE,
  Uuidv7IdGenerator,
  type Clock,
  type UnitOfWork,
  type User,
} from '@rivian-kanban/core'
import { type PasswordHasher } from '../auth/password-hasher.ts'

/**
 * `users create-admin --email` (docs/architecture/deployment.md#bootstrap):
 * creates (or, with --force, resets) an admin with a one-time temp password,
 * `must_change_password` set. Idempotence guard: refuses while an active
 * admin already exists unless forced — the same command is the break-glass
 * recovery when every admin is locked out.
 */

export interface CreateAdminDeps {
  uow: UnitOfWork
  clock: Clock
  hasher: PasswordHasher
  /** The seeded automation user — never counts as a manageable admin. */
  systemUserId: string
}

export interface CreateAdminResult {
  user: User
  tempPassword: string
  /** False when an existing account was promoted/reset instead. */
  created: boolean
}

export class ActiveAdminExistsError extends Error {
  constructor(email: string) {
    super(`an active admin (${email}) already exists — pass --force to add or reset anyway`)
    this.name = 'ActiveAdminExistsError'
  }
}

export async function createAdminUser(
  deps: CreateAdminDeps,
  email: string,
  force = false,
): Promise<CreateAdminResult> {
  const { uow, clock, hasher, systemUserId } = deps
  const normalizedEmail = email.toLowerCase()

  const users = await uow.run((tx) => tx.userAccounts.list())
  const activeAdmin = users.find(
    (user) => user.role === 'admin' && user.isActive && user.id !== systemUserId,
  )
  if (activeAdmin !== undefined && !force) throw new ActiveAdminExistsError(activeAdmin.email)

  const tempPassword = randomBytes(12).toString('base64url')
  const passwordHash = await hasher.hash(tempPassword)

  const existing = await uow.run((tx) => tx.userAccounts.findByEmail(normalizedEmail))
  if (existing !== null) {
    const user: User = {
      ...existing.user,
      role: 'admin',
      isActive: true,
      mustChangePassword: true,
    }
    await uow.run(async (tx) => {
      await tx.userAccounts.update(user)
      await tx.userAccounts.setPassword(user.id, passwordHash, true)
      await tx.sessions.revokeOthersForUser(user.id)
    })
    return { user, tempPassword, created: false }
  }

  const ids = new Uuidv7IdGenerator()
  const user: User = {
    id: ids.newId(),
    email: normalizedEmail,
    displayName: normalizedEmail.split('@')[0] ?? normalizedEmail,
    role: 'admin',
    mustChangePassword: true,
    slackUserId: null,
    isActive: true,
    timezone: DEFAULT_TIMEZONE,
    createdAt: clock.now().toISOString(),
  }
  await uow.run((tx) => tx.userAccounts.insert(user, passwordHash))
  return { user, tempPassword, created: true }
}
