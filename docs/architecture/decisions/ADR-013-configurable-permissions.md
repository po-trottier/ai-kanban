# ADR-013: Permissions are permissive by default; roles are data in the policy document

**Status**: accepted (2026-07-16, product-owner direction). Revised 2026-07-17:
roles-as-data supersedes the fixed `user | admin` enum + `actionGates` + per-transition
`minRole` model described in the original draft.

## Context

The original design enforced a multi-level role hierarchy on transitions (a regular user moves
work, an elevated role approves/closes). The product owner rejected hierarchy-by-default: _"By default everyone can
move anywhere. You can support the feature but we should not enforce hierarchy by default."_
That in turn requires a way to configure the board — an app-wide admin view.

The first cut hard-coded a two-level `user < admin` enum, expressed permission tightening as an
`actionGates` object plus a `minRole` on each transition edge, and role-restricted the admin
surface to the fixed `admin` level. That model could not answer "give the vendor-coordinator
role everything except closing cards" without a code change. Roles are now DATA: admins define
custom roles and toggle each permission per role from the dashboard.

## Decision

- **Default policy: permissive.** The SEEDED default still lets any authenticated user create,
  edit, move, reorder, block, cancel, reopen, archive, comment, and attach — on any card, into
  any lane. What it withholds by default is deleting other people's content and the six manage\*
  surfaces.
- **Roles are data, not a code enum.** The policy document carries a `roles` array. Each role is
  a stable key, a human name, and a sparse permission grant map. A permission is granted by the
  PRESENCE of `true`; absence means not granted, i.e. **default-deny**. No `false` values ever
  accumulate.
- **Policy as data, not code.** The policy engine in `core` evaluates a Zod-validated policy
  document (this is the canonical schema):

  ```ts
  {
    transitionEnforcement: boolean // false in the seed
    transitions: Array<{
      // the workflow graph — TOPOLOGY ONLY, active only
      from: LaneKey // when enforcement is on. Lanes referenced by key;
      to: LaneKey // PUT /policy may submit any valid graph. No per-edge
    }> // role gate — a move needs the card.move permission,
    // then (if enforcement on) the edge must exist.
    roles: Array<{
      // at least one role (min 1)
      key: string // /^[a-z][a-z0-9_]*$/, max 40; unique across roles
      name: string // 1–60 chars, display label
      permissions: Partial<
        Record<
          // sparse grant map; only `true` is legal
          Permission,
          true // present+true = granted; absent = default-deny
        >
      >
    }>
    businessHours: {
      // the working day the burn-down + overdue clock count within
      startHour: number // 0–23, default 9
      endHour: number //  1–24, default 17; must be after startHour
    } // defaulted, so policies written before it existed stay valid
  }
  ```

  The permission set (`PERMISSIONS`, a const tuple in `packages/core/src/domain/policy.ts`) is:
  `card.create`, `card.update`, `card.move`, `card.cancel`, `card.reopen`, `card.archive`,
  `card.block`, `card.unblock`, `comment.add`, `comment.deleteOthers`, `attachment.add`,
  `attachment.deleteOthers`, `viewAllActivity` (a READ gate — the cross-user activity feed
  `GET /events` / MCP `list_activity`; without it a caller is scoped to their own activity), and
  the six manage\* surfaces `manageUsers`, `manageRoles`, `manageLocations`, `manageLanes`,
  `managePolicy`, `manageTokens`. (`card.reorder` folds into `card.move` — a same-lane reorder is
  part of the move permission and skips topology.)

  Two schema refinements guard the document: role keys must be UNIQUE, and at least one role
  must grant `manageRoles` (otherwise a policy could lock everyone out of ever editing roles
  again). The seeded document has enforcement off, the researched 7-lane graph ready to
  activate, and two roles: `user` (name "User") granting today's permissive posture — everything
  except `*.deleteOthers` and the manage\* surfaces — and `admin` (name "Administrator") granting
  every permission. Stored as append-only versions in `board_policies` — configuration changes
  have history and authorship like everything else.

- **The working day is policy, not a hard-coded constant.** `businessHours` (default Mon–Fri
  09:00–17:00) is the window the work burn-down and the `overdue` facet count business time within;
  time outside it — and weekends — never accrues against an estimate. It rides the same policy
  document, edited by `managePolicy` holders under the Permissions tab (a start/end hour pair), and
  is Zod-refined so the day always starts before it ends. `businessMinutesBetween(start, end, hours)`
  in `core` takes it as a parameter (defaulting to 09:00–17:00), so REST, MCP, and the web burn-down
  share one definition (see [board-filters.md](../board-filters.md#the-overdue-facet)).
- **The manage\* permissions replace the fixed admin surface.** The app-wide settings view and
  its APIs are no longer gated on a hard-coded `admin` role. Each surface checks its own
  permission against the active policy: user management → `manageUsers`, service tokens →
  `manageTokens`, lanes → `manageLanes`, locations → `manageLocations`, the policy editor →
  `managePolicy`, and role editing → `manageRoles`. A denial names the rule `permission:<perm>`
  (e.g. `permission:managePolicy`).
- **A user's / token's `role` is a bare string KEY**, validated at WRITE time against the active
  policy's defined roles (an unknown key is a 400 validation error). The `users.role` and
  `service_tokens.role` columns stay `text` — no enum, no column migration.
- **`PUT /policy` cannot orphan an assigned role.** Applying a document that drops a role key
  still assigned to any active user or live (non-revoked) service token is rejected with 409
  (`role-in-use`).
- **Ownership rules are identity, not RBAC**, and stay in the services where the row is loaded:
  editing a comment requires being its author; deleting your own comment or attachment always
  succeeds and short-circuits BEFORE the `*.deleteOthers` grant. This is
  impersonation-prevention, not hierarchy.
- **Always-on rules are data integrity, not hierarchy** (unaffected by policy): waiting-lane
  entry requires reason + resume date; cancellation is an explicit action, never a drag;
  optimistic-lock and validation rules.
- **App-wide admin view** in the SPA: user management; the Columns tab (lane labels/WIP limits
  PLUS the workflow-transitions matrix + enforcement toggle, so columns and the moves allowed
  between them are configured together); the Permissions tab (the role editor — a per-permission
  checkbox grid — only); location tree; service tokens — each shown when the caller's role grants
  the matching manage\* permission.

## Consequences

The policy engine keeps a SINGLE `evaluatePolicy` path for all three adapters, whether
permissive or tightened — no dual code paths. The always-on prefixes run first, in order:
(1) system-actor bypass, (2) read-scope tokens denied every write (`token-scope-read`),
(3) comment editing author-only (`comment-author-only`), (4) resource-ownership short-circuit
for delete-others. Then a grant lookup — `grant(actor, perm, policy)` finds the role by key and
checks `role.permissions[perm] === true`, else denies with `permission:<perm>`. For `card.move`
it checks the grant THEN the transition topology when enforcement is on. Server admin services
use the mirror guard `ensurePermission(actor, perm, policy)` (system bypass, read-scope denied,
else grant; throws `PolicyDeniedError`).

The old `admin` PolicyAction, the `admin-only` rule, and the `roleAtLeast` ordering are gone,
replaced by the six manage\* permissions. `GET /policy` lets the SPA render current affordances
(MCP agents simply receive policy denials as tool errors). The transition matrix in workflow.md
documents the _seeded graph_, not default behavior. "Last active admin" is redefined as the last
active user whose role grants `manageUsers` (the admin-equivalent set, computed from the active
policy) — that user cannot be demoted below it or deactivated. Tests must cover both postures
(default-permissive and enforcement-on) and custom roles with arbitrary grant maps.
