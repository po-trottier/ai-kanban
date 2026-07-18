import { type PolicyDocument } from '@rivian-kanban/core'

/**
 * The manage* permissions that unlock the admin settings surface. A role with
 * ANY of them may open /settings (the page then shows only the tabs its grants
 * allow). Kept here as the single source shared by the header gear and the
 * settings page so the two can never disagree about who gets in.
 */
const MANAGE_PERMISSIONS = [
  'manageUsers',
  'manageRoles',
  'manageLocations',
  'manageLanes',
  'managePolicy',
  'manageTokens',
] as const

/**
 * Whether `role` may open admin settings — any manage* grant in the active
 * policy (ADR-013: roles are data, so gate on the PERMISSIONS a role carries,
 * never on a hardcoded 'admin' key). An undefined policy (still loading) yields
 * false so the gear and page stay hidden until the grants are known
 * (default-deny). The server re-enforces every manage* endpoint regardless.
 */
export function canManageAnything(policy: PolicyDocument | undefined, role: string): boolean {
  const myRole = policy?.roles.find((candidate) => candidate.key === role)
  return (
    myRole !== undefined && MANAGE_PERMISSIONS.some((perm) => myRole.permissions[perm] === true)
  )
}
