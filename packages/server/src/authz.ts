import { NotFoundError, type PolicyDocument, type TransactionContext } from '@rivian-kanban/core'

/**
 * The active policy document, loaded inside an admin service's transaction so
 * its manage* permission check reads the SAME version the write will race
 * against. The structural seed always writes one (data-model.md#seeding), so a
 * missing row is a boot-invariant violation that must fail loudly — never a
 * silent permissive fallback. Mirrors core's own `activePolicy` helper, which
 * is package-internal to core's services.
 */
export async function loadActivePolicy(
  tx: TransactionContext,
  boardId: string,
): Promise<PolicyDocument> {
  const active = await tx.policies.getActive(boardId)
  if (active === null) throw new NotFoundError('policy')
  return active.config
}

/** Whether `roleKey` is a role defined in the active policy document. */
export function roleExists(policy: PolicyDocument, roleKey: string): boolean {
  return policy.roles.some((role) => role.key === roleKey)
}

/**
 * The role keys that grant `manageUsers` — the admin-EQUIVALENT roles. The
 * last-active-admin guard (users/user-admin-service.ts) protects against
 * demoting or deactivating the final active account that can still manage
 * users, computed from the active policy rather than a hard-coded `admin`
 * string now that roles are data (ADR-013).
 */
export function manageUsersRoleKeys(policy: PolicyDocument): Set<string> {
  return new Set(
    policy.roles.filter((role) => role.permissions.manageUsers === true).map((role) => role.key),
  )
}
