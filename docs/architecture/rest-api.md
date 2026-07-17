# REST API

Base path `/api/v1`. JSON everywhere except attachment upload (multipart) and download.
OpenAPI 3.1 is generated from the Zod route schemas and served at `/api/v1/docs` (Scalar UI) in
non-production; the JSON spec is always available at `/api/v1/openapi.json`.

## Conventions

- **Versioning**: additive-only evolution within `/api/v1`; breaking changes require `/api/v2`
  (three consumer types — SPA, MCP agents, Slack flows — depend on this contract).
- **Validation**: every route declares Zod schemas for params/query/body/response, imported from
  `core`. A boot-time hook fails the process if any route lacks them. Responses are serialized
  through the response schema — fields not in the schema (e.g. `password_hash`) cannot leak.
- **Auth**: session cookie (see [security.md](security.md)). All routes require auth except
  `POST /auth/login` and the health endpoints.
- **Authorization**: the Role column below shows the out-of-the-box default. Rows marked
  *policy* consult the configurable permission policy, which defaults to "any authenticated
  user" ([ADR-013](decisions/ADR-013-configurable-permissions.md)); admin rows are fixed.
- **Optimistic locking**: mutating card routes require `If-Match: "<version>"`; stale versions
  get `409 Conflict` with the current resource in the body.
- **Pagination**: cursor-based (`?cursor=&limit=`), keyset on `(created_at, id)`. Responses:
  `{ items, nextCursor | null }`. No offset pagination anywhere.
- **Errors**: RFC 9457 problem+json: `{ type, title, status, detail, ...extras }`. Validation
  errors include a `issues` array from Zod. Codes: 400 validation, 401 unauthenticated,
  403 policy denial (includes `rule`), 404, 409 conflict (lock or duplicate), 413 upload too
  large, 415 bad MIME, 422 illegal transition (includes `from`, `to`), 429 rate limited.
- **Idempotency**: `POST /cards` accepts an optional `Idempotency-Key` header (uniqueness
  enforced for 24 h) so Slack retries cannot double-create tickets.

## Endpoints

### Auth & users
| Method & path | Role | Description |
| --- | --- | --- |
| POST /auth/login | — | email+password → session cookie |
| POST /auth/logout | any | destroy session |
| GET /auth/me | any | current user + role |
| GET /users | any | active users (id, name, role) for pickers |
| POST /users, PATCH /users/:id | admin | manage users (create sets temp password; PATCH can deactivate/change role) |

### Board & cards
| Method & path | Role | Description |
| --- | --- | --- |
| GET /board | any | lanes (with WIP state) + non-archived card summaries in position order |
| GET /cards | any | filterable list: `lane, assignee, reporter, priority, tag, blocked, q (title search), includeArchived`; cursor-paginated |
| POST /cards | any | create → lands in `intake` (origin `manual`); server assigns position at top of lane |
| GET /cards/:id | any | full detail: card + tags + location + attachment metadata |
| PATCH /cards/:id | any (policy) | field edits (title, description, priority, estimate, assignee, location, tags); If-Match required; one audit event per changed field |
| POST /cards/:id/move | any (policy) | `{ toLane, prevCardId, nextCardId, waitingReason?, expectedResumeAt? }`; If-Match required; waiting-lane fields always required on entry |
| POST /cards/:id/cancel | any (policy) | `{ resolution }` |
| POST /cards/:id/reopen | any (policy) | done → ready |
| POST /cards/:id/block / unblock | any (policy) | `{ reason }` on block |

### Comments
| Method & path | Role | Description |
| --- | --- | --- |
| GET /cards/:id/comments | any | full thread, oldest-first |
| POST /cards/:id/comments | any | `{ body, parentCommentId? }` |
| PATCH /comments/:id | author | edit own comment |
| DELETE /comments/:id | author (policy for others) | soft delete |

### Attachments
| Method & path | Role | Description |
| --- | --- | --- |
| POST /cards/:id/attachments | any (policy) | multipart; ≤ 25 MB/file, ≤ 10 files/card; MIME sniffed server-side (images + PDF only) |
| GET /attachments/:id | any | download; `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff` |
| DELETE /attachments/:id | uploader (policy for others) | soft delete + blob removal |

### History & metadata
| Method & path | Role | Description |
| --- | --- | --- |
| GET /cards/:id/events | any | audit trail for a card; filter `type`; cursor-paginated |
| GET /events | any | board-wide event query (`type`, `since`); feeds AI/reporting |
| GET /locations | any | tree; admin CRUD via POST/PATCH/DELETE |
| GET /tags | any | known tags for autocomplete |
| GET /stream | any | SSE: `{ type, cardId, version, eventId }` invalidation hints |

### Admin
| Method & path | Role | Description |
| --- | --- | --- |
| PATCH /lanes/:id | admin | edit label / WIP limit |
| GET /policy | any | active permission policy (drives UI affordances) |
| PUT /policy | admin | apply a new policy version (append-only history) |
| POST /service-tokens, GET /service-tokens, DELETE /service-tokens/:id | admin | MCP credentials; raw token returned once on create |

### Operational (not under /api/v1, no auth)
`GET /healthz` (process up), `GET /readyz` (DB ping), `GET /metrics` (Prometheus; bound to
localhost/internal network only).
