import { usePolicy } from '../api/meta.ts'

/**
 * Role picker options derived from the ACTIVE POLICY's defined roles (ADR-013 —
 * roles are data now), not a static enum. Every role picker (user row/create,
 * token create) and role-label lookup reads from here so custom roles appear
 * automatically. Falls back to an empty list until the policy loads.
 */
export interface RoleOption {
  value: string
  label: string
}

export function useRoleOptions(): RoleOption[] {
  const policy = usePolicy()
  // policyResponseSchema unwraps the version record to the bare document.
  return (policy.data?.roles ?? []).map((role) => ({ value: role.key, label: role.name }))
}

/** Human name for a role key from the active policy; falls back to the key. */
export function useRoleLabel(): (roleKey: string) => string {
  const options = useRoleOptions()
  return (roleKey: string) => options.find((option) => option.value === roleKey)?.label ?? roleKey
}
