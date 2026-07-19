import { type LaneKey } from '../domain/constants.ts'
import { type Actor } from '../domain/entities.ts'
import { PolicyDeniedError } from '../domain/errors.ts'
import { type Permission, type PolicyDocument, type PolicyTransition } from '../domain/policy.ts'

/**
 * One evaluation path for all three inbound surfaces (ADR-013): always-on
 * identity rules first, then the configurable policy document. Roles are data —
 * each defines a sparse permission grant map, and anything a role does not
 * grant is DENIED (default-deny). Resource-ownership short-circuits (own
 * comment, own attachment) still beat a missing delete-others grant.
 */

/** A mutating action plus the context the rules need. Reads are never policy-checked. */
export type PolicyAction =
  | { type: 'card.create' }
  | { type: 'card.update' }
  | { type: 'card.move'; fromLane: LaneKey; toLane: LaneKey }
  | { type: 'card.reorder'; lane: LaneKey }
  | { type: 'card.cancel' }
  | { type: 'card.reopen' }
  | { type: 'card.archive' }
  /** Discard a just-created draft: owner-only, no grantable admin override (v1). */
  | { type: 'card.delete'; reporterId: string }
  | { type: 'card.block' }
  | { type: 'card.unblock' }
  | { type: 'comment.add' }
  | { type: 'comment.edit'; authorId: string }
  | { type: 'comment.delete'; authorId: string }
  | { type: 'attachment.add' }
  | { type: 'attachment.remove'; uploaderId: string }
  /** The manage* admin surfaces — each gated by its own permission. */
  | { type: 'manageUsers' }
  | { type: 'manageRoles' }
  | { type: 'manageLocations' }
  | { type: 'manageLanes' }
  | { type: 'managePolicy' }
  | { type: 'manageTokens' }

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

function denied(rule: string): PolicyDecision {
  return { allowed: false, kind: 'denied', rule }
}

/**
 * The core grant lookup: does the actor's role (matched by key against the
 * active policy) grant `perm`? An unknown role key, or a role that omits the
 * permission, is denied — default-deny. The denial rule names the permission
 * so problem+json and the SPA can explain it.
 */
function grant(actor: Actor, perm: Permission, policy: PolicyDocument): PolicyDecision {
  const role = policy.roles.find((candidate) => candidate.key === actor.role)
  // `perm` is a fixed Permission literal, not attacker-controlled — safe index.
  // eslint-disable-next-line security/detect-object-injection
  return role?.permissions[perm] === true ? ALLOW : denied(`permission:${perm}`)
}

/**
 * Read-capability predicate: does the actor's role grant `perm`? Unlike the
 * write path (`evaluatePolicy`/`ensurePermission`), it does NOT deny read-scope
 * tokens — a scope-`read` summarizer token is exactly who may hold a read gate
 * like `viewAllActivity`. System actors bypass (scheduled jobs); everyone else
 * needs the grant (default-deny). No throw, no rule string — a plain boolean
 * the caller uses to widen or scope a read.
 */
export function hasPermission(actor: Actor, perm: Permission, policy: PolicyDocument): boolean {
  if (actor.kind === 'system') return true
  return grant(actor, perm, policy).allowed
}

/**
 * Throwing guard for a manage* surface, used by the server's admin services.
 * Mirrors `evaluatePolicy` exactly: system actors bypass (scheduled jobs),
 * read-scope tokens are denied every write, everyone else needs the grant.
 */
export function ensurePermission(actor: Actor, perm: Permission, policy: PolicyDocument): void {
  if (actor.kind === 'system') return
  if (actor.scope === 'read') throw new PolicyDeniedError(READ_SCOPE_RULE)
  const decision = grant(actor, perm, policy)
  if (!decision.allowed && decision.kind === 'denied') {
    throw new PolicyDeniedError(decision.rule)
  }
}

function findTransition(
  policy: PolicyDocument,
  from: LaneKey,
  to: LaneKey,
): PolicyTransition | undefined {
  return policy.transitions.find((edge) => edge.from === from && edge.to === to)
}

/** Topology-only check when enforcement is on; no per-edge role gate anymore. */
function checkTransition(policy: PolicyDocument, from: LaneKey, to: LaneKey): PolicyDecision {
  if (!policy.transitionEnforcement) return ALLOW
  const edge = findTransition(policy, from, to)
  if (!edge) return { allowed: false, kind: 'illegal-transition', from, to }
  return ALLOW
}

/**
 * Evaluates whether `actor` may perform `action` under `policy`.
 *
 * Rule order (unchanged always-on prefixes): system actors bypass everything
 * (scheduled jobs); read-scope tokens are denied every mutation; comment
 * editing is author-only; resource-ownership short-circuits for delete-others.
 * Then the role's permission grant, and — when transition enforcement is on —
 * the workflow graph topology for moves.
 */
export function evaluatePolicy(
  actor: Actor,
  action: PolicyAction,
  policy: PolicyDocument,
): PolicyDecision {
  if (actor.kind === 'system') return ALLOW
  if (actor.scope === 'read') return denied(READ_SCOPE_RULE)

  switch (action.type) {
    case 'comment.edit':
      return actor.id === action.authorId ? ALLOW : denied(COMMENT_AUTHOR_RULE)
    case 'comment.delete':
      // Ownership beats a missing deleteOthers grant.
      if (actor.id === action.authorId) return ALLOW
      return grant(actor, 'comment.deleteOthers', policy)
    case 'attachment.remove':
      if (actor.id === action.uploaderId) return ALLOW
      return grant(actor, 'attachment.deleteOthers', policy)
    case 'card.delete':
      // Owner-only: no grantable admin-delete permission exists in v1.
      return actor.id === action.reporterId ? ALLOW : denied('card-owner-only')
    case 'card.cancel':
      return grant(actor, 'card.cancel', policy)
    case 'card.reopen':
      return grant(actor, 'card.reopen', policy)
    case 'card.archive':
      return grant(actor, 'card.archive', policy)
    case 'card.reorder':
      // A same-lane reorder is part of the move permission, exempt from topology.
      return grant(actor, 'card.move', policy)
    case 'card.move': {
      const permitted = grant(actor, 'card.move', policy)
      if (!permitted.allowed) return permitted
      return checkTransition(policy, action.fromLane, action.toLane)
    }
    case 'card.create':
      return grant(actor, 'card.create', policy)
    case 'card.update':
      return grant(actor, 'card.update', policy)
    case 'card.block':
      return grant(actor, 'card.block', policy)
    case 'card.unblock':
      return grant(actor, 'card.unblock', policy)
    case 'comment.add':
      return grant(actor, 'comment.add', policy)
    case 'attachment.add':
      return grant(actor, 'attachment.add', policy)
    case 'manageUsers':
      return grant(actor, 'manageUsers', policy)
    case 'manageRoles':
      return grant(actor, 'manageRoles', policy)
    case 'manageLocations':
      return grant(actor, 'manageLocations', policy)
    case 'manageLanes':
      return grant(actor, 'manageLanes', policy)
    case 'managePolicy':
      return grant(actor, 'managePolicy', policy)
    case 'manageTokens':
      return grant(actor, 'manageTokens', policy)
  }
}
