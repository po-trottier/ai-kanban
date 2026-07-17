import { roleAtLeast, type LaneKey, type Role } from '../domain/constants.ts'
import { type Actor } from '../domain/entities.ts'
import {
  type PolicyActionGates,
  type PolicyDocument,
  type PolicyTransition,
} from '../domain/policy.ts'

/**
 * One evaluation path for all three inbound surfaces (ADR-013): always-on
 * identity rules first, then the configurable policy document. Permissive by
 * default — nothing is role-gated until an admin configures a gate, except the
 * admin surface itself.
 */

/** A mutating action plus the context the rules need. Reads are never policy-checked. */
export type PolicyAction =
  | { type: 'card.create' }
  | { type: 'card.update' }
  | { type: 'card.move'; fromLane: LaneKey; toLane: LaneKey }
  | { type: 'card.reorder'; lane: LaneKey }
  | { type: 'card.cancel' }
  | { type: 'card.reopen' }
  | { type: 'card.block' }
  | { type: 'card.unblock' }
  | { type: 'comment.add' }
  | { type: 'comment.edit'; authorId: string }
  | { type: 'comment.delete'; authorId: string }
  | { type: 'attachment.add' }
  | { type: 'attachment.remove'; uploaderId: string }
  /** The admin surface — always role-restricted, cannot be opened up. */
  | { type: 'admin' }

export type PolicyDecision =
  /** Proceed. */
  | { allowed: true }
  /** Role/identity denial → 403 problem+json naming the failed rule. */
  | { allowed: false; kind: 'denied'; rule: string }
  /** No such edge in the enforced workflow graph → 422. */
  | { allowed: false; kind: 'illegal-transition'; from: LaneKey; to: LaneKey }

const ALLOW: PolicyDecision = { allowed: true }

/** Always-on identity rule names (docs/architecture/security.md#authorization). */
export const READ_SCOPE_RULE = 'token-scope-read'
export const COMMENT_AUTHOR_RULE = 'comment-author-only'
export const ADMIN_ONLY_RULE = 'admin-only'

function denied(rule: string): PolicyDecision {
  return { allowed: false, kind: 'denied', rule }
}

function checkGate(
  gate: keyof PolicyActionGates,
  minRole: Role | undefined,
  role: Role,
): PolicyDecision {
  if (minRole !== undefined && !roleAtLeast(role, minRole)) {
    return denied(`actionGates.${gate}`)
  }
  return ALLOW
}

function findTransition(
  policy: PolicyDocument,
  from: LaneKey,
  to: LaneKey,
): PolicyTransition | undefined {
  return policy.transitions.find((edge) => edge.from === from && edge.to === to)
}

function checkTransition(policy: PolicyDocument, actor: Actor, from: LaneKey, to: LaneKey) {
  if (!policy.transitionEnforcement) return ALLOW
  const edge = findTransition(policy, from, to)
  if (!edge) return { allowed: false, kind: 'illegal-transition', from, to } as const
  if (edge.minRole !== undefined && !roleAtLeast(actor.role, edge.minRole)) {
    return denied(`transition:${from}->${to}`)
  }
  return ALLOW
}

/**
 * Evaluates whether `actor` may perform `action` under `policy`.
 *
 * Rule order: system actors bypass everything (scheduled jobs); read-scope
 * tokens are denied every mutation (always-on identity rule); the admin
 * surface requires the admin role (always-on); comment editing is
 * author-only (always-on); then the configurable action gates and — when
 * transition enforcement is on — the workflow graph with per-edge minRole.
 */
export function evaluatePolicy(
  actor: Actor,
  action: PolicyAction,
  policy: PolicyDocument,
): PolicyDecision {
  if (actor.kind === 'system') return ALLOW
  if (actor.scope === 'read') return denied(READ_SCOPE_RULE)

  switch (action.type) {
    case 'admin':
      return actor.role === 'admin' ? ALLOW : denied(ADMIN_ONLY_RULE)
    case 'comment.edit':
      return actor.id === action.authorId ? ALLOW : denied(COMMENT_AUTHOR_RULE)
    case 'comment.delete':
      if (actor.id === action.authorId) return ALLOW
      return checkGate('deleteOthersComments', policy.actionGates.deleteOthersComments, actor.role)
    case 'attachment.remove':
      if (actor.id === action.uploaderId) return ALLOW
      return checkGate(
        'deleteOthersAttachments',
        policy.actionGates.deleteOthersAttachments,
        actor.role,
      )
    case 'card.cancel':
      // Cancel is an explicit action, never a drag — exempt from the graph.
      return checkGate('cancel', policy.actionGates.cancel, actor.role)
    case 'card.reopen': {
      const gate = checkGate('reopen', policy.actionGates.reopen, actor.role)
      if (!gate.allowed) return gate
      // Reopen is the done→ready edge when enforcement is on.
      return checkTransition(policy, actor, 'done', 'ready')
    }
    case 'card.reorder':
      return action.lane === 'ready'
        ? checkGate('reorderReady', policy.actionGates.reorderReady, actor.role)
        : ALLOW
    case 'card.move':
      return checkTransition(policy, actor, action.fromLane, action.toLane)
    case 'card.create':
    case 'card.update':
    case 'card.block':
    case 'card.unblock':
    case 'comment.add':
    case 'attachment.add':
      return ALLOW
  }
}
