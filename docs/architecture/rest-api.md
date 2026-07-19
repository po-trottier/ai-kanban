# REST API

Base path `/api/v1`. JSON everywhere except attachment upload (multipart) and download.
OpenAPI 3.1 is generated from the Zod route schemas and served at `/api/v1/docs` (Scalar UI) in
non-production; the JSON spec is always available at `/api/v1/openapi.json`.

## Conventions

- **Versioning**: the SPA is the sole REST consumer today (MCP and Slack call core services
  in-process), and it ships in lockstep with the server from this repo — so contract changes
  deploy together. The `/api/v1` prefix is kept because it is cheap; formal additive-only
  discipline and `/api/v2` promotion start when the first external REST consumer appears.
- **Validation**: every route declares Zod schemas for params/query/body/response, imported from
  `core`. A boot-time hook fails the process if any route lacks them. Responses are serialized
  through the response schema — fields not in the schema (e.g. `password_hash`) cannot leak.
- **Auth**: session cookie (see [security.md](security.md)). All routes require auth except
  `POST /auth/login`, the first-boot setup pair `GET|POST /setup` (hard-disabled once any
  non-system user exists — see security.md#authentication), and the health endpoints.
- **Authorization**: the Role column below shows the out-of-the-box default. Rows marked
  _policy_ consult the configurable permission policy, which defaults to "any authenticated
  user" ([ADR-013](decisions/ADR-013-configurable-permissions.md)). Roles are data: the manage\*
  rows below check the caller's role for the matching permission (`manageUsers`, `manageLanes`,
  `manageLocations`, `managePolicy`, `manageTokens`, `manageRoles`) against the active policy —
  a denial is 403 naming `permission:<perm>`. The seeded `admin` role grants all of them; the
  seeded `user` role grants none.
- **Optimistic locking**: mutating card routes require `If-Match: "<version>"`; stale versions
  get `409 Conflict` with the current resource in the body.
- **Pagination**: cursor-based (`?cursor=&limit=`), keyset on `(created_at, id)`. The cursor is
  an opaque base64url token — clients never parse it. Default `limit` 50, max 200 (400 above).
  Responses: `{ items, nextCursor | null }`. Order: `GET /cards` and `GET /events` (board-wide
  feed) newest-first; `GET /cards/:id/events` and comments oldest-first. No offset pagination
  anywhere.
- **Errors**: RFC 9457 problem+json: `{ type, title, status, detail, ...extras }`. Validation
  errors include a `issues` array from Zod. Codes: 400 validation, 401 unauthenticated,
  403 policy denial (includes `rule`) — plus `invalid-current-password` (wrong current password
  on change-password; no `rule`) and `csrf`/`password-change-required` — 404, 409 conflict
  (stale version, stale move neighbors, attachment limit, archived card,
  `setup-already-complete` on `POST /setup` once any user exists), 413 upload too large,
  415 bad MIME, 422 illegal transition when enforcement is on (includes `from`, `to`), 429 rate
  limited (with `Retry-After`), 507 `insufficient-storage` for both upload quotas (the per-user
  daily quota and the `BLOB_DIR` high-water mark — see security.md#uploads).

## Endpoints

### Auth & users

| Method & path                 | Role          | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST /auth/login              | —             | email+password → fresh session cookie (never reuses an id)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| GET /setup                    | —             | `{ required: boolean }` — true iff ZERO non-system users exist of any status (first-boot probe; never flips back to true)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| POST /setup                   | —             | first boot only: `{ email, displayName, password, timezone?, theme? }` creates the initial admin (password through the change-password policy) and issues a session like login; `timezone` is the browser-auto-detected IANA zone (PST default if omitted); `theme` defaults to `system` (not auto-detected); 409 `setup-already-complete` once any user exists (zero-check + insert commit in one transaction); shares the login rate bucket                                                                                                                                                                                                                                                                                                               |
| POST /auth/logout             | any           | destroy session                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| POST /auth/change-password    | any           | `{ currentPassword, newPassword }`; revokes the user's other sessions; clears `must_change_password`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| GET /auth/me                  | any           | current user + role + `mustChangePassword` + `timezone` + `theme`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| PATCH /auth/me                | any           | self-service profile update: `{ timezone, theme }` ONLY (strictObject — role/active/email are rejected, so no privilege escalation) writing the caller's OWN row (id = session user, never a path param — no IDOR); touches no password/session state. Blocked while `must_change_password` is set                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| GET /users                    | any           | active users (id, name, role) for pickers; `email` is included only for actors granted `manageUsers` (the admin users table) — gated on the permission, not a hardcoded role, so a custom admin role sees it too. Loads the WHOLE active roster, so it does not scale past a few hundred users — the assignee/reporter/user pickers use `GET /users/search` instead                                                                                                                                                                                                                                                                                                                                                                                         |
| GET /users/search             | any           | the scalable async user-picker read (10k+ users never loaded whole). Query: `q` (case-insensitive substring over display name AND email — trimmed, ≤ 200 chars; empty/omitted returns the first `limit` users so the picker shows something before typing), `limit` (default 20, hard cap 50 → 400 above), `ids` (comma-joined or repeated; resolve an explicit, bounded set ≤ 100 of already-selected ids to their picker shape — takes precedence over `q`/`limit`, unknown ids are simply absent, and inactive users ARE returned so a card's deactivated assignee still renders). Otherwise search returns ACTIVE users only, ordered by display name; the automation user is always excluded. Same `PickerUser` shape and email gating as `GET /users` |
| POST /users, PATCH /users/:id | `manageUsers` | manage users (403 `permission:manageUsers` without the grant). Create and the PATCH `resetPassword` action return a one-time temp password (shown once, `must_change_password` set); PATCH can deactivate/change role — `role` is a bare role key validated against the active policy (unknown → 400) — except the last active admin-equivalent user (the last active user whose role grants `manageUsers`), which is 409                                                                                                                                                                                                                                                                                                                                   |

While `must_change_password` is set, every route except change-password/logout/me returns 403 (including `PATCH /auth/me`).

### Board & cards

| Method & path                   | Role                   | Description                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET /board                      | any                    | lanes (with WIP state) + non-archived card summaries in position order. The hottest read: the serialized body is memoized until the next committed mutation, with a validating `ETag` (`If-None-Match` → 304)                                                                                                                                                                                                                             |
| POST /board/query               | any                    | the same `BoardSnapshot` envelope as `GET /board`, narrowed by a `boardFilterSchema` body (all facets optional, `{}` = the full board). A read that takes a body — ten facets, several arrays, brittle as query params — so NOT cached/ETag'd (per-filter, not the hot shared read). `wipLimitExceeded` still reflects the FULL active lane count, so filtering never hides a WIP breach. Full spec: [board-filters.md](board-filters.md) |
| GET /cards                      | any                    | filterable list: `lane, assignee, reporter, priority, tag, blocked, waitingReason, overdueResume, q (title+description substring), includeArchived`; cursor-paginated                                                                                                                                                                                                                                                                     |
| POST /cards                     | any                    | body: `title` (required), `description` ('' default), `priority` (default `P2`), `assigneeId?`, `locationId?`, `tags?`, `estimateMinutes?`. Lands in `intake` at the top, origin `manual`, reporter = acting user. Slack and MCP creation share this schema                                                                                                                                                                               |
| GET /cards/:id                  | any                    | full detail: card + tags + location + attachment metadata                                                                                                                                                                                                                                                                                                                                                                                 |
| PATCH /cards/:id                | any (policy)           | field edits (title, description, priority, estimate, assignee, location, tags as full-replacement array); also `waitingReason?` + `expectedResumeAt?`, editable IN PLACE only while the card sits in `waiting_parts_vendor` (409 `conflict` otherwise); changing `expectedResumeAt` clears `resume_alerted_at` so the overdue alert re-arms; If-Match required; one audit event per changed field                                         |
| POST /cards/:id/move            | any (policy)           | `{ toLane (lane key, always required — equal to the current lane for reorders), prevCardId, nextCardId, waitingReason?, expectedResumeAt? }`; If-Match required; waiting-lane fields required on entry. Neighbors that no longer exist in the target lane (or an exhausted uniqueness retry) → 409 with the current card                                                                                                                  |
| POST /cards/:id/cancel          | any (policy)           | `{ resolution }`                                                                                                                                                                                                                                                                                                                                                                                                                          |
| POST /cards/:id/reopen          | any (policy)           | done → ready; also clears `archived_at`                                                                                                                                                                                                                                                                                                                                                                                                   |
| POST /cards/:id/archive         | any (policy `archive`) | manual archive of a Done card (completed or cancelled); If-Match required; sets `archived_at` and emits `card.archived`; 409 `conflict` if not in Done, 409 `card-archived` if already archived. The 90-day `doneArchival` job is the automatic backstop                                                                                                                                                                                  |
| POST /cards/:id/block / unblock | any (policy)           | `{ reason }` on block                                                                                                                                                                                                                                                                                                                                                                                                                     |

### Filter presets

Per-user saved board filters (no `manage*` permission — managing your own presets is an identity
right, like editing your own comment). Every route is scoped to the caller's own rows; an id owned
by another user is `404` (indistinguishable from unknown). Full spec:
[board-filters.md](board-filters.md#presets).

| Method & path              | Role | Description                                                                         |
| -------------------------- | ---- | ----------------------------------------------------------------------------------- |
| GET /filter-presets        | any  | the caller's presets, newest-first                                                  |
| POST /filter-presets       | any  | `{ name, filter }` (filter is a `boardFilterSchema`) → `201` the created preset     |
| PATCH /filter-presets/:id  | any  | `{ name?, filter? }` — rename and/or replace the filter (`404` if not the caller's) |
| DELETE /filter-presets/:id | any  | `204` (`404` if not the caller's)                                                   |

(The two built-in presets — "My Cards", "Overdue" — are core constants the SPA renders, NOT rows,
so they have no endpoint.)

### Comments

| Method & path            | Role                       | Description                  |
| ------------------------ | -------------------------- | ---------------------------- |
| GET /cards/:id/comments  | any                        | full thread, oldest-first    |
| POST /cards/:id/comments | any                        | `{ body, parentCommentId? }` |
| PATCH /comments/:id      | author                     | edit own comment             |
| DELETE /comments/:id     | author (policy for others) | soft delete                  |

### Relations

Typed card-to-card links, shown only in the detail panel. Full spec:
[card-relations.md](card-relations.md).

| Method & path                      | Role | Description                                                              |
| ---------------------------------- | ---- | ------------------------------------------------------------------------ |
| GET /cards/:id/relations           | any  | the card's relations (both directions), each resolved to the other card  |
| POST /cards/:id/relations          | any  | `{ toCardId, type }` → `201`; self/duplicate `409`, unknown target `404` |
| DELETE /cards/:id/relations/:relId | any  | `204` — must touch `:id` (else `404`)                                    |

### Attachments

| Method & path               | Role                         | Description                                                                                                                                                                                                                                      |
| --------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST /cards/:id/attachments | any (policy)                 | multipart, exactly one file per request in a part named `file`; ≤ 25 MB/file, ≤ 10 active files/card (soft-deleted don't count; 11th → 409 `attachment-limit`, enforced in the insert transaction); MIME sniffed server-side (images + PDF only) |
| GET /attachments/:id        | any                          | download; `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`                                                                                                                                                                   |
| DELETE /attachments/:id     | uploader (policy for others) | soft delete + blob removal                                                                                                                                                                                                                       |

### History & metadata

| Method & path         | Role | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET /cards/:id/events | any  | audit trail for a card, oldest-first; filter `type`; cursor-paginated. Each event carries the stored `actorKind` + `actorId` (unchanged). For `actorKind: 'mcp'` the response ALSO carries two DERIVED, optional fields — `actorLabel` (the service-token name) and `onBehalfOfUserId` (the user who minted the token, its `createdBy`) — resolved at read time so clients render "<token> on behalf of <user>". Non-admins cannot list service tokens, so the server enriches these; the stored `actorId` stays the token id. |
| GET /events           | any  | board-wide activity feed: card events across ALL cards, NEWEST-first; cursor-paginated. Filters (all optional): `since` (ISO datetime — defaults to 24h before now; an invalid value is 400), `type`, `cardId`, `actorKind`. Same enriched-event shape as `GET /cards/:id/events` (mcp events carry `actorLabel`/`onBehalfOfUserId`).                                                                                                                                                                                          |
| GET /lanes            | any  | the board's lanes in board (position) order: `id, key, label, position, wipLimit`                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| GET /locations        | any  | tree; CRUD via POST/PATCH/DELETE requires `manageLocations` (403 `permission:manageLocations`). DELETE removes the location and its whole subtree (building → floors → rooms) in one transaction and clears `location_id` on any card that referenced a removed node (location is optional — the card survives); deleting a location with children never conflicts, missing id is 404                                                                                                                                          |
| GET /tags             | any  | known tags for autocomplete                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| GET /stream           | any  | SSE: `{ type, cardId, version, eventId }` invalidation hints                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

### Admin

| Method & path                                                                                          | Role           | Description                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------ | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PATCH /lanes/:id                                                                                       | `manageLanes`  | edit label / WIP limit (403 `permission:manageLanes`)                                                                                                                                                                                                                                                                                                                                                                       |
| GET /policy                                                                                            | any            | active permission policy (drives UI affordances)                                                                                                                                                                                                                                                                                                                                                                            |
| PUT /policy                                                                                            | `managePolicy` | apply a new policy version (append-only history); see body schema below                                                                                                                                                                                                                                                                                                                                                     |
| POST /service-tokens, GET /service-tokens, POST /service-tokens/:id/rotate, DELETE /service-tokens/:id | `manageTokens` | MCP credentials (403 `permission:manageTokens`); each token has a human `name` (shown in history as "<name> on behalf of <minter>"); raw token returned once on create; `role` is a role key validated against the active policy (unknown → 400); rotate mints a fresh secret in place (same `{ token, rawToken }` shape, keeps name/role/scope), retiring the old one immediately — 404 unknown id, 409 on a revoked token |

#### PUT /policy body

```jsonc
{
  "transitionEnforcement": false, // boolean; when true, moves are checked against `transitions`
  "transitions": [
    // workflow graph, topology only (no per-edge role gate)
    { "from": "review", "to": "done" },
  ],
  "roles": [
    // at least one role
    {
      "key": "user", // /^[a-z][a-z0-9_]*$/, ≤ 40, unique across roles
      "name": "User", // 1–60 chars
      "permissions": { "card.create": true, "card.move": true },
      // sparse map; only `true` is legal, absent = default-deny
    },
  ],
}
```

Refinements (400 on violation): role keys must be unique, and at least one role must grant
`manageRoles`. Applying a document that DROPS a role key still assigned to any active user or
live (non-revoked) service token is rejected with 409 `role-in-use`. Denied when the caller's
role lacks `managePolicy` (403 `permission:managePolicy`).

### Operational (not under /api/v1)

`GET /healthz` (process up) and `GET /readyz` (DB ping) — unauthenticated, for the Docker
healthcheck. `GET /version` — unauthenticated `{ version, gitSha, builtAt }` (no sensitive
data). `GET /metrics` (Prometheus) is served on a **separate internal listener port** that
Compose does not publish and the reverse proxy never routes (see deployment.md).

`/api/v1/openapi.json` and the docs UI require an authenticated session like every other
`/api/v1` route ("always available" means in all environments, not anonymous).
