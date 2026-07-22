import { z } from 'zod'
import { isoDateTimeSchema, laneKeySchema } from './entities.ts'

/**
 * The canonical policy-document schema from ADR-013. Policy is data, not code:
 * append-only versions in `board_policies`, evaluated by the policy engine.
 * Roles are DATA too — admins define custom roles and toggle each permission
 * per role from the dashboard; absent permission = not granted (default-deny).
 */

/**
 * Every mutating capability the policy engine can gate. A role grants a subset;
 * anything absent is denied. Ownership rules (own-comment edit, own-row) live
 * in services and are NOT permissions here.
 */
export const PERMISSIONS = [
  'card.create',
  'card.update',
  'card.move',
  'card.cancel',
  'card.reopen',
  'card.archive',
  'card.block',
  'card.unblock',
  'comment.add',
  'comment.deleteOthers',
  'attachment.add',
  'attachment.deleteOthers',
  /**
   * See the CROSS-USER activity feed (`GET /events`, MCP `list_activity`) — a
   * read gate, unlike the mutating capabilities above. Without it a caller is
   * scoped to their own activity; the admin/audit roles grant it.
   */
  'viewAllActivity',
  'manageUsers',
  'manageRoles',
  'manageLocations',
  'manageLanes',
  'managePolicy',
  'manageTokens',
] as const
export type Permission = (typeof PERMISSIONS)[number]

/**
 * A custom role: a stable key, a human name, and a sparse grant map. Only
 * `true` is a legal value — a permission is granted by presence, denied by
 * absence (default-deny), so no `false` entries ever accumulate.
 */
export const roleDefinitionSchema = z.strictObject({
  key: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/, 'lowercase letters, digits, and underscores; must start a letter')
    .max(40),
  name: z.string().min(1).max(60),
  permissions: z.partialRecord(z.enum(PERMISSIONS), z.literal(true)),
})
export type RoleDefinition = z.infer<typeof roleDefinitionSchema>

export const policyTransitionSchema = z.strictObject({
  from: laneKeySchema,
  to: laneKeySchema,
})
export type PolicyTransition = z.infer<typeof policyTransitionSchema>

/**
 * The working day the burn-down clock + overdue verdict count against — the
 * board's business hours, admin-configurable (Settings → Permissions). Hours are
 * whole numbers in [0, 24]; the day is Monday–Friday. Applied in the VIEWER's own
 * time zone on the web burn-down (ADR-019) and in UTC for the server-side overdue
 * filter (SQLite can't count business time — board-filters.md).
 */
export const businessHoursSchema = z
  .strictObject({
    /** Local hour the working day starts (0–23). */
    startHour: z.number().int().min(0).max(23),
    /** Local hour the working day ends (1–24); must be after `startHour`. */
    endHour: z.number().int().min(1).max(24),
  })
  .refine((hours) => hours.startHour < hours.endHour, {
    message: 'the working day must start before it ends',
    path: ['endHour'],
  })
export type BusinessHours = z.infer<typeof businessHoursSchema>

/** The seeded 09:00–17:00 working day (workflow.md: 1 working day = 8 hours). */
export const DEFAULT_BUSINESS_HOURS: BusinessHours = { startHour: 9, endHour: 17 }

export const policyDocumentSchema = z
  .strictObject({
    /** false in the seed — permissive by default (product-owner decision). */
    transitionEnforcement: z.boolean(),
    /** The workflow graph; consulted only when enforcement is on. */
    transitions: z.array(policyTransitionSchema),
    /** The defined roles; a user/token's `role` string must match a key here. */
    roles: z.array(roleDefinitionSchema).min(1),
    /** The working day the burn-down + overdue verdict count against. Defaulted so
     * policies written before this setting existed stay valid. */
    businessHours: businessHoursSchema.default(DEFAULT_BUSINESS_HOURS),
  })
  .refine((doc) => new Set(doc.roles.map((role) => role.key)).size === doc.roles.length, {
    message: 'role keys must be unique',
    path: ['roles'],
  })
  .refine((doc) => doc.roles.some((role) => role.permissions.manageRoles === true), {
    // Otherwise a policy could lock everyone out of ever editing roles again.
    message: 'at least one role must grant manageRoles',
    path: ['roles'],
  })
  .refine((doc) => doc.transitions.every((edge) => edge.from !== edge.to), {
    // A lane never transitions to itself (that is a same-lane reorder, exempt
    // from the graph). The workflow matrix editor disables the diagonal too.
    message: 'a transition cannot loop a lane to itself',
    path: ['transitions'],
  })
  .refine(
    (doc) =>
      new Set(doc.transitions.map((edge) => `${edge.from}->${edge.to}`)).size ===
      doc.transitions.length,
    { message: 'duplicate transition edge', path: ['transitions'] },
  )
export type PolicyDocument = z.infer<typeof policyDocumentSchema>

/** A stored `board_policies` version (config + authorship). */
export const boardPolicySchema = z.strictObject({
  id: z.uuid(),
  boardId: z.uuid(),
  config: policyDocumentSchema,
  createdBy: z.uuid(),
  createdAt: isoDateTimeSchema,
})
export type BoardPolicy = z.infer<typeof boardPolicySchema>

/** Every permission, granted. Reused for the seeded admin role. */
const ALL_PERMISSIONS_GRANTED: RoleDefinition['permissions'] = Object.fromEntries(
  PERMISSIONS.map((permission) => [permission, true]),
)

/**
 * The seeded default: enforcement off, the researched 7-lane workflow graph
 * ready to activate (docs/product/workflow.md), and two roles — `user`
 * (today's permissive posture, minus deleting others' content and the manage*
 * surface) and `admin` (everything).
 */
export const DEFAULT_POLICY_DOCUMENT: PolicyDocument = {
  transitionEnforcement: false,
  businessHours: DEFAULT_BUSINESS_HOURS,
  transitions: [
    { from: 'intake', to: 'waiting_approval' },
    { from: 'waiting_approval', to: 'ready' },
    { from: 'waiting_approval', to: 'intake' },
    { from: 'ready', to: 'in_progress' },
    { from: 'in_progress', to: 'ready' },
    { from: 'in_progress', to: 'waiting_parts_vendor' },
    { from: 'waiting_parts_vendor', to: 'in_progress' },
    { from: 'in_progress', to: 'review' },
    { from: 'review', to: 'done' },
    { from: 'review', to: 'in_progress' },
    { from: 'done', to: 'ready' },
  ],
  roles: [
    {
      key: 'user',
      name: 'User',
      permissions: {
        'card.create': true,
        'card.update': true,
        'card.move': true,
        'card.cancel': true,
        'card.reopen': true,
        'card.archive': true,
        'card.block': true,
        'card.unblock': true,
        'comment.add': true,
        'attachment.add': true,
      },
    },
    {
      key: 'admin',
      name: 'Administrator',
      permissions: ALL_PERMISSIONS_GRANTED,
    },
  ],
}
