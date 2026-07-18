import { DEFAULT_POLICY_DOCUMENT, type Permission, type PolicyDocument } from '../domain/policy.ts'

/**
 * Test helper: the default policy with the `user` role's grant of `perm`
 * removed, so a plain `user` actor is denied that permission (default-deny)
 * while `admin` still has everything. Replaces the old `actionGates` fixtures
 * now that gating is per-role permission grants (ADR-013).
 */
export function policyDenyingUser(...perms: Permission[]): PolicyDocument {
  const removed = new Set<Permission>(perms)
  return {
    ...DEFAULT_POLICY_DOCUMENT,
    roles: DEFAULT_POLICY_DOCUMENT.roles.map((role) =>
      role.key === 'user'
        ? {
            ...role,
            permissions: Object.fromEntries(
              Object.entries(role.permissions).filter(([key]) => !removed.has(key as Permission)),
            ),
          }
        : role,
    ),
  }
}
