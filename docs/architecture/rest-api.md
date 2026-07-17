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
  user" ([ADR-013](decisions/ADR-013-configurable-permissions.md)); admin rows are fixed.
- **Optimistic locking**: mutating card routes require `If-Match: "<version>"`; stale versions
  get `409 Conflict` with the current resource in the body.
- **Pagination**: cursor-based (`?cursor=&limit=`), keyset on `(created_at, id)`. The cursor is
  an opaque base64url token — clients never parse it. Default `limit` 50, max 200 (400 above).
  Responses: `{ items, nextCursor | null }`. Order: `GET /cards` newest-first;
  `GET /cards/:id/events` and comments oldest-first. No offset pagination anywhere.
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

| Method & path                 | Role  | Description                                                                                                                                                                                                                                                                                  |
| ----------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST /auth/login              | —     | email+password → fresh session cookie (never reuses an id)                                                                                                                                                                                                                                   |
| GET /setup                    | —     | `{ required: boolean }` — true iff ZERO non-system users exist of any status (first-boot probe; never flips back to true)                                                                                                                                                                    |
| POST /setup                   | —     | first boot only: `{ email, displayName, password }` creates the initial admin (password through the change-password policy) and issues a session like login; 409 `setup-already-complete` once any user exists (zero-check + insert commit in one transaction); shares the login rate bucket |
| POST /auth/logout             | any   | destroy session                                                                                                                                                                                                                                                                              |
| POST /auth/change-password    | any   | `{ currentPassword, newPassword }`; revokes the user's other sessions; clears `must_change_password`                                                                                                                                                                                         |
| GET /auth/me                  | any   | current user + role + `mustChangePassword`                                                                                                                                                                                                                                                   |
| GET /users                    | any   | active users (id, name, role) for pickers                                                                                                                                                                                                                                                    |
| POST /users, PATCH /users/:id | admin | manage users. Create and the PATCH `resetPassword` action return a one-time temp password (shown once, `must_change_password` set); PATCH can deactivate/change role — except the last active admin (409)                                                                                    |

While `must_change_password` is set, every route except change-password/logout/me returns 403.

### Board & cards

| Method & path                   | Role                   | Description                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET /board                      | any                    | lanes (with WIP state) + non-archived card summaries in position order. The hottest read: the serialized body is memoized until the next committed mutation, with a validating `ETag` (`If-None-Match` → 304)                                                                                                                                                                                     |
| GET /cards                      | any                    | filterable list: `lane, assignee, reporter, priority, tag, blocked, waitingReason, overdueResume, q (title+description substring), includeArchived`; cursor-paginated                                                                                                                                                                                                                             |
| POST /cards                     | any                    | body: `title` (required), `description` ('' default), `priority` (default `P2`), `assigneeId?`, `locationId?`, `tags?`, `estimateMinutes?`. Lands in `intake` at the top, origin `manual`, reporter = acting user. Slack and MCP creation share this schema                                                                                                                                       |
| GET /cards/:id                  | any                    | full detail: card + tags + location + attachment metadata                                                                                                                                                                                                                                                                                                                                         |
| PATCH /cards/:id                | any (policy)           | field edits (title, description, priority, estimate, assignee, location, tags as full-replacement array); also `waitingReason?` + `expectedResumeAt?`, editable IN PLACE only while the card sits in `waiting_parts_vendor` (409 `conflict` otherwise); changing `expectedResumeAt` clears `resume_alerted_at` so the overdue alert re-arms; If-Match required; one audit event per changed field |
| POST /cards/:id/move            | any (policy)           | `{ toLane (lane key, always required — equal to the current lane for reorders), prevCardId, nextCardId, waitingReason?, expectedResumeAt? }`; If-Match required; waiting-lane fields required on entry. Neighbors that no longer exist in the target lane (or an exhausted uniqueness retry) → 409 with the current card                                                                          |
| POST /cards/:id/cancel          | any (policy)           | `{ resolution }`                                                                                                                                                                                                                                                                                                                                                                                  |
| POST /cards/:id/reopen          | any (policy)           | done → ready; also clears `archived_at`                                                                                                                                                                                                                                                                                                                                                           |
| POST /cards/:id/archive         | any (policy `archive`) | manual archive of a Done card (completed or cancelled); If-Match required; sets `archived_at` and emits `card.archived`; 409 `conflict` if not in Done, 409 `card-archived` if already archived. The 90-day `doneArchival` job is the automatic backstop                                                                                                                                          |
| POST /cards/:id/block / unblock | any (policy)           | `{ reason }` on block                                                                                                                                                                                                                                                                                                                                                                             |

### Comments

| Method & path            | Role                       | Description                  |
| ------------------------ | -------------------------- | ---------------------------- |
| GET /cards/:id/comments  | any                        | full thread, oldest-first    |
| POST /cards/:id/comments | any                        | `{ body, parentCommentId? }` |
| PATCH /comments/:id      | author                     | edit own comment             |
| DELETE /comments/:id     | author (policy for others) | soft delete                  |

### Attachments

| Method & path               | Role                         | Description                                                                                                                                                                                                                                      |
| --------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST /cards/:id/attachments | any (policy)                 | multipart, exactly one file per request in a part named `file`; ≤ 25 MB/file, ≤ 10 active files/card (soft-deleted don't count; 11th → 409 `attachment-limit`, enforced in the insert transaction); MIME sniffed server-side (images + PDF only) |
| GET /attachments/:id        | any                          | download; `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`                                                                                                                                                                   |
| DELETE /attachments/:id     | uploader (policy for others) | soft delete + blob removal                                                                                                                                                                                                                       |

### History & metadata

| Method & path         | Role | Description                                                                                                                                                                                                                                                                                                                   |
| --------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET /cards/:id/events | any  | audit trail for a card, oldest-first; filter `type`; cursor-paginated                                                                                                                                                                                                                                                         |
| GET /locations        | any  | tree; admin CRUD via POST/PATCH/DELETE. DELETE removes the location and its whole subtree (building → floors → rooms) in one transaction and clears `location_id` on any card that referenced a removed node (location is optional — the card survives); deleting a location with children never conflicts, missing id is 404 |
| GET /tags             | any  | known tags for autocomplete                                                                                                                                                                                                                                                                                                   |
| GET /stream           | any  | SSE: `{ type, cardId, version, eventId }` invalidation hints                                                                                                                                                                                                                                                                  |

### Admin

| Method & path                                                         | Role  | Description                                        |
| --------------------------------------------------------------------- | ----- | -------------------------------------------------- |
| PATCH /lanes/:id                                                      | admin | edit label / WIP limit                             |
| GET /policy                                                           | any   | active permission policy (drives UI affordances)   |
| PUT /policy                                                           | admin | apply a new policy version (append-only history)   |
| POST /service-tokens, GET /service-tokens, DELETE /service-tokens/:id | admin | MCP credentials; raw token returned once on create |

### Operational (not under /api/v1)

`GET /healthz` (process up) and `GET /readyz` (DB ping) — unauthenticated, for the Docker
healthcheck. `GET /version` — unauthenticated `{ version, gitSha, builtAt }` (no sensitive
data). `GET /metrics` (Prometheus) is served on a **separate internal listener port** that
Compose does not publish and the reverse proxy never routes (see deployment.md).

`/api/v1/openapi.json` and the docs UI require an authenticated session like every other
`/api/v1` route ("always available" means in all environments, not anonymous).
