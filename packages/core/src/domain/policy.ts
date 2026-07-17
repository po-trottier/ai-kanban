import { z } from 'zod'
import { isoDateTimeSchema, laneKeySchema, roleSchema } from './entities.ts'

/**
 * The canonical policy-document schema from ADR-013. Policy is data, not code:
 * append-only versions in `board_policies`, evaluated by the policy engine.
 */

export const policyTransitionSchema = z.strictObject({
  from: laneKeySchema,
  to: laneKeySchema,
  /** Per-edge role gate, active only when transitionEnforcement is on. */
  minRole: roleSchema.optional(),
})
export type PolicyTransition = z.infer<typeof policyTransitionSchema>

export const policyActionGatesSchema = z.strictObject({
  cancel: roleSchema.optional(),
  reopen: roleSchema.optional(),
  /** Manual archive of a Done card; permissive by default (docs/product/workflow.md#archival). */
  archive: roleSchema.optional(),
  reorderReady: roleSchema.optional(),
  deleteOthersComments: roleSchema.optional(),
  deleteOthersAttachments: roleSchema.optional(),
})
export type PolicyActionGates = z.infer<typeof policyActionGatesSchema>

export const policyDocumentSchema = z.strictObject({
  /** false in the seed — permissive by default (product-owner decision). */
  transitionEnforcement: z.boolean(),
  /** The workflow graph; consulted only when enforcement is on. */
  transitions: z.array(policyTransitionSchema),
  /** Each optional; absent = any authenticated user. */
  actionGates: policyActionGatesSchema,
})
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

/**
 * The seeded default: enforcement off, no action gates, and the researched
 * 7-lane workflow graph ready to activate (docs/product/workflow.md).
 */
export const DEFAULT_POLICY_DOCUMENT: PolicyDocument = {
  transitionEnforcement: false,
  transitions: [
    { from: 'intake', to: 'waiting_approval' },
    { from: 'waiting_approval', to: 'ready', minRole: 'supervisor' },
    { from: 'waiting_approval', to: 'intake' },
    { from: 'ready', to: 'in_progress' },
    { from: 'in_progress', to: 'ready' },
    { from: 'in_progress', to: 'waiting_parts_vendor' },
    { from: 'waiting_parts_vendor', to: 'in_progress' },
    { from: 'in_progress', to: 'review' },
    { from: 'review', to: 'done', minRole: 'supervisor' },
    { from: 'review', to: 'in_progress' },
    { from: 'done', to: 'ready', minRole: 'supervisor' },
  ],
  actionGates: {},
}
