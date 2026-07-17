# ADR-013: Permissions are permissive by default; hierarchy is opt-in configuration

**Status**: accepted (2026-07-16, product-owner direction)

## Context

The original design enforced a role hierarchy on transitions (technician moves work, supervisor
approves/closes). The product owner rejected hierarchy-by-default: *"By default everyone can
move anywhere. You can support the feature but we should not enforce hierarchy by default."*
That in turn requires a way to configure the board — an app-wide admin view.

## Decision

- **Default policy: permissive.** Any authenticated user can create, edit, move, reorder,
  block, cancel, reopen, and attach — on any card, into any lane.
- **Policy as data, not code.** The policy engine in `core` evaluates a Zod-validated policy
  document: `{ transitionEnforcement, transitions[{from,to,minRole?}], actionGates }`.
  The seeded document has enforcement off and carries the researched 7-lane workflow graph
  ready to activate. Stored as append-only versions in `board_policies` — configuration changes
  have history and authorship like everything else.
- **The admin surface is the ONLY thing role-restricted by default.** The app-wide settings
  view and its APIs (users, lanes, permission policy, locations, service tokens) require the
  `admin` role, always — it cannot be opened up, because it is where permissions themselves are
  configured. No other page or action checks a role until an admin enables a gate.
- **Ownership rules are identity, not RBAC** (also unaffected by policy defaults): editing a
  comment requires being its author. This is impersonation-prevention, not hierarchy.
- **Always-on rules are data integrity, not hierarchy** (unaffected by policy): waiting-lane
  entry requires reason + resume date; cancellation is an explicit action, never a drag;
  optimistic-lock and validation rules.
- **App-wide admin view** in the SPA: user management, lane labels/WIP limits, permission
  policy editor (enforcement toggle, per-transition gates, action gates), location tree,
  service tokens.
- Roles (`requester < technician < supervisor < admin`) remain as assignable levels that gates
  *may* reference; they impose nothing until a gate is enabled.

## Consequences

The policy engine is one evaluation path for all three adapters, whether permissive or
tightened — no dual code paths. `GET /policy` lets the SPA and MCP agents render/reason about
current affordances. The transition matrix in workflow.md documents the *seeded graph*, not
default behavior. Tests must cover both postures (default-permissive and enforcement-on).
