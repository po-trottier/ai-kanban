/**
 * @rivian-kanban/core — framework-free domain package.
 *
 * Owns entities, Zod schemas, ports, the policy engine, and services.
 * See docs/architecture/overview.md and ADR-004. Populated via TDD (task: core domain).
 */

export const LANE_KEYS = [
  'intake',
  'waiting_approval',
  'ready',
  'in_progress',
  'waiting_parts_vendor',
  'review',
  'done',
] as const
export type LaneKey = (typeof LANE_KEYS)[number]

export const ROLES = ['requester', 'technician', 'supervisor', 'admin'] as const
export type Role = (typeof ROLES)[number]

export const PRIORITIES = ['P0', 'P1', 'P2'] as const
export type Priority = (typeof PRIORITIES)[number]
