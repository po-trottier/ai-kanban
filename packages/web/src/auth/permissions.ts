import { type Permission, type PolicyDocument } from '@rivian-kanban/core'

/**
 * Whether `role` grants a specific permission in the active policy (ADR-013:
 * roles are data, so gate on the PERMISSIONS a role carries, never a hardcoded
 * 'admin' key). Lets the Settings page show each admin tab only to roles that
 * can use it (per-tab gating, default-deny), so a user never sees a tab they
 * can't act on. An undefined policy (still loading) yields false; the server
 * re-enforces the matching endpoint regardless.
 */
export function roleGrants(
  policy: PolicyDocument | undefined,
  role: string,
  permission: Permission,
): boolean {
  const myRole = policy?.roles.find((candidate) => candidate.key === role)
  return myRole?.permissions[permission] === true
}
