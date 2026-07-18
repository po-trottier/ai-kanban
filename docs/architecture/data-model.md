# Data Model

Drizzle ORM schema, SQLite dialect today. Portability rules (enforced, see
[dev/standards.md](../dev/standards.md)): conservative column types only (TEXT, INTEGER, REAL),
ISO-8601 UTC strings for timestamps, TEXT ids (UUIDv7), no SQLite-only features outside the
`db` package. The Postgres port is a one-time mechanical `sqlite-core` → `pg-core` schema
rewrite behind unchanged repository ports ([ADR-003](decisions/ADR-003-drizzle-sqlite.md)).

## Entity-relationship sketch

```
users ─┬────────────< cards >────────────┬─ lanes >── boards ──< board_policies
       │  (reporter, assignee)           │
       │                                 ├──< card_tags >── tags
       ├──< comments >── cards           ├──< comments (threaded via parent_comment_id)
       ├──< attachments >── cards        ├──< attachments
       └──< card_events >── cards        └── locations (optional, tree via parent_id)
sessions >── users        service_tokens (MCP)
```

## Tables

### users

| column               | type                                        | notes                                                                                                                                                                               |
| -------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id                   | TEXT PK                                     | UUIDv7                                                                                                                                                                              |
| email                | TEXT UNIQUE NOT NULL                        | lowercased; a `lower(email)` unique index enforces case-insensitive uniqueness                                                                                                      |
| display_name         | TEXT NOT NULL                               | ≤ 100 chars                                                                                                                                                                         |
| role                 | TEXT NOT NULL                               | a role KEY, not an enum — validated at write time against the active policy's `roles` (unknown → 400); stays `text`, no column migration (ADR-013)                                  |
| password_hash        | TEXT NOT NULL                               | argon2id                                                                                                                                                                            |
| must_change_password | INTEGER NOT NULL DEFAULT 0                  | set on create/admin-reset; while set, the session may only call change-password                                                                                                     |
| slack_user_id        | TEXT NULL                                   | bound on first Slack use (matched by email once, then matched by id — never re-resolved)                                                                                            |
| is_active            | INTEGER NOT NULL                            | soft-disable; inactive users cannot log in (web or Slack) but remain referenced                                                                                                     |
| timezone             | TEXT NOT NULL DEFAULT 'America/Los_Angeles' | IANA display zone; the web renders every timestamp + the work-progress burn-down in it. Auto-detected from the browser at signup; PST default otherwise (ADR-019)                   |
| theme                | TEXT NOT NULL DEFAULT 'system'              | display theme `light` \| `dark` \| `system`; the web maps `system` to Mantine's `auto` (follows prefers-color-scheme). Not auto-detected — the browser resolves at render (ADR-019) |
| created_at           | TEXT NOT NULL                               | ISO-8601 UTC                                                                                                                                                                        |

The structural seed includes a `system` user (display "Automation", no password, cannot log
in) used as the reporter for MCP-created cards when no reporter is specified. The last active
user whose role grants `manageUsers` (the admin-equivalent set) can never be demoted or
deactivated (enforced invariant; see security.md).

### boards

Single seeded row in v1; cards reference it so multi-board is additive later.
`id, name, created_at`.

### lanes

Seeded rows — stable `key`, editable `label` (see [workflow.md](../product/workflow.md)).

| column    | type             | notes                               |
| --------- | ---------------- | ----------------------------------- |
| id        | TEXT PK          |                                     |
| board_id  | TEXT FK          |                                     |
| key       | TEXT NOT NULL    | machine key, UNIQUE(board_id, key)  |
| label     | TEXT NOT NULL    | display, admin-editable, ≤ 50 chars |
| position  | INTEGER NOT NULL | board order                         |
| wip_limit | INTEGER NULL     | soft limit                          |

### locations

Optional tree: `id, parent_id NULL FK, kind ('building'|'floor'|'room'), name`. Seeded,
admin-editable.

### board_policies

Permission policy as data, **append-only versions** — newest row per board wins, history is
free (see [ADR-013](decisions/ADR-013-configurable-permissions.md)).

| column     | type             | notes                                                                                       |
| ---------- | ---------------- | ------------------------------------------------------------------------------------------- |
| id         | TEXT PK          | UUIDv7                                                                                      |
| board_id   | TEXT FK NOT NULL |                                                                                             |
| config     | TEXT NOT NULL    | Zod-validated JSON; full schema in [ADR-013](decisions/ADR-013-configurable-permissions.md) |
| created_by | TEXT FK NOT NULL | admin who applied it                                                                        |
| created_at | TEXT NOT NULL    |                                                                                             |

Seeded with the `DEFAULT_POLICY_DOCUMENT` (ADR-013): `transitionEnforcement: false`, the 7-lane
workflow graph (topology only, no `minRole`) ready to activate, and a `roles` array of two roles
— `user` (permissive default minus `*.deleteOthers` and the manage\* surfaces) and `admin` (all
permissions). Permissions are a sparse grant map: present+`true` = granted, absent = default-deny.
Index: `(board_id, created_at)`.

### cards

| column                                               | type                       | notes                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id                                                   | TEXT PK                    | UUIDv7                                                                                                                                                                                                                                                                                                                       |
| board_id                                             | TEXT FK NOT NULL           |                                                                                                                                                                                                                                                                                                                              |
| number                                               | INTEGER NOT NULL           | human-readable sequential ticket number (Jira-style, shown as `#N`), UNIQUE(board_id, number); assigned as `MAX(number)+1` inside the create transaction — atomic under SQLite's single writer, the unique index is the backstop (the Postgres port would use a sequence). The UUID `id` stays the internal key              |
| lane_id                                              | TEXT FK NOT NULL           | current status                                                                                                                                                                                                                                                                                                               |
| position                                             | TEXT NOT NULL              | fractional key; UNIQUE(lane_id, position)                                                                                                                                                                                                                                                                                    |
| title                                                | TEXT NOT NULL              | ≤ 200 chars                                                                                                                                                                                                                                                                                                                  |
| description                                          | TEXT NOT NULL DEFAULT ''   | markdown, ≤ 20,000 chars                                                                                                                                                                                                                                                                                                     |
| priority                                             | TEXT NOT NULL              | `P0 \| P1 \| P2`                                                                                                                                                                                                                                                                                                             |
| estimate_minutes                                     | INTEGER NULL               |                                                                                                                                                                                                                                                                                                                              |
| reporter_id                                          | TEXT FK NOT NULL           |                                                                                                                                                                                                                                                                                                                              |
| assignee_id                                          | TEXT FK NULL               |                                                                                                                                                                                                                                                                                                                              |
| location_id                                          | TEXT FK NULL               | optional (PO decision)                                                                                                                                                                                                                                                                                                       |
| origin                                               | TEXT NOT NULL              | `manual \| slack \| mcp \| import \| pm`                                                                                                                                                                                                                                                                                     |
| resolution                                           | TEXT NULL                  | terminal only. `completed` is system-set on non-cancel entry into done; `cancelled \| declined \| duplicate` only via the cancel action; cleared by reopen — the explicit action or a drag out of done, both consulting the `reopen` action gate (see workflow.md#terminal-states)                                           |
| blocked                                              | INTEGER NOT NULL DEFAULT 0 | flag, any lane                                                                                                                                                                                                                                                                                                               |
| blocked_reason                                       | TEXT NULL                  | required when blocked=1, ≤ 500 chars                                                                                                                                                                                                                                                                                         |
| blocked_at                                           | TEXT NULL                  |                                                                                                                                                                                                                                                                                                                              |
| waiting_reason                                       | TEXT NULL                  | required in waiting lane: `parts \| vendor \| access \| info \| funding`; cleared on lane exit; editable in place via `PATCH /cards/:id` while the card is in the waiting lane                                                                                                                                               |
| expected_resume_at                                   | TEXT NULL                  | required in waiting lane; date-only `YYYY-MM-DD` (overdue = the following UTC day onward); cleared on lane exit; editable in place via `PATCH /cards/:id` while the card is in the waiting lane                                                                                                                              |
| resume_alerted_at                                    | TEXT NULL                  | claimed in the same transaction that selects the overdue card, BEFORE the DM is attempted — at-most-once per episode: a delivery failure does not re-fire; cleared on lane exit. Also cleared when `expected_resume_at` is edited in place (in-lane `PATCH /cards/:id`) so the hourly overdue alert re-arms for the new date |
| work_started_at                                      | TEXT NULL                  | ISO-8601 UTC; stamped on the card's FIRST entry into `in_progress` and never overwritten by later moves; cleared on reopen. Anchors the web work burn-down bar (business-hours elapsed vs `estimate_minutes`)                                                                                                                |
| slack_channel_id / slack_thread_ts / slack_permalink | TEXT NULL                  | source metadata for origin=slack                                                                                                                                                                                                                                                                                             |
| version                                              | INTEGER NOT NULL DEFAULT 1 | optimistic lock ([ADR-012](decisions/ADR-012-optimistic-locking.md))                                                                                                                                                                                                                                                         |
| created_at / updated_at                              | TEXT NOT NULL              |                                                                                                                                                                                                                                                                                                                              |
| archived_at                                          | TEXT NULL                  | set by manual archive (`POST /cards/:id/archive`) or the 90-day `doneArchival` backstop; cleared on reopen                                                                                                                                                                                                                   |

Indexes: `(lane_id, position)`, UNIQUE `(board_id, number)` (ticket-number uniqueness, also
serves `MAX(number)`), `(board_id, archived_at)`, `(assignee_id)`, `(reporter_id)`,
and `(created_at, id)` for the newest-first keyset list query. Two partial indexes keep hot
reads proportional to LIVE rows despite the in-place done-lane archive growing forever:
`(lane_id, position) WHERE archived_at IS NULL` (board snapshot / WIP counts) and
`(created_at, id) WHERE blocked = 1 AND archived_at IS NULL` (the stale-cards blocked leg).

### tags / card_tags

`tags(id, name UNIQUE COLLATE NOCASE)`; `card_tags(card_id, tag_id, PK(card_id, tag_id))`.
Free-form (≤ 50 chars, trimmed, case preserved, matched case-insensitively), created on first
use, normalized for per-tag queries. Card updates send tags as a full-replacement array.

### comments

| column                  | type             | notes                                                              |
| ----------------------- | ---------------- | ------------------------------------------------------------------ |
| id                      | TEXT PK          |                                                                    |
| card_id                 | TEXT FK NOT NULL |                                                                    |
| parent_comment_id       | TEXT FK NULL     | one level of nesting: replies to a reply attach to the same parent |
| author_id               | TEXT FK NOT NULL |                                                                    |
| body                    | TEXT NOT NULL    | markdown, ≤ 10,000 chars                                           |
| created_at / updated_at | TEXT NOT NULL    |                                                                    |
| deleted_at              | TEXT NULL        | soft delete keeps thread shape; body rendered as “deleted”         |

Index: `(card_id, created_at)`.

### attachments

`id, card_id FK, filename (original, display only), mime, bytes, sha256, storage_key
(random UUID — the blob's name on disk/S3), uploaded_by FK, created_at, deleted_at NULL`.
Binaries live behind the BlobStorePort, never in the database. Index: `(card_id)`.

### card_events — the audit trail

Append-only. Written **in the same transaction** as the mutation it records
([ADR-005](decisions/ADR-005-audit-trail.md)). Never updated or deleted (PII removal is a hard
delete of source rows plus a `card.pii_deleted` tombstone event).

| column     | type             | notes                                          |
| ---------- | ---------------- | ---------------------------------------------- |
| id         | TEXT PK          | UUIDv7 (time-ordered)                          |
| card_id    | TEXT FK NOT NULL |                                                |
| actor_id   | TEXT NULL        | user id or service-token id; NULL for `system` |
| actor_kind | TEXT NOT NULL    | `user \| mcp \| slack \| system`               |
| event_type | TEXT NOT NULL    | see below                                      |
| payload    | TEXT NOT NULL    | JSON, shape per event type                     |
| created_at | TEXT NOT NULL    |                                                |

Index: `(card_id, created_at)` — per-card history is the only event query surface in v1; a
board-wide event index arrives with its first consumer.

Event types (distinct so status history is never polluted by reorder noise):

| event_type                                       | payload                                                                                                  |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| card.created                                     | `{ snapshot }`                                                                                           |
| card.status_changed                              | `{ fromLane, toLane, wipLimitExceeded?, clearedWaiting? }`                                               |
| card.reordered                                   | `{ lane, prevCardId, nextCardId }`                                                                       |
| card.field_changed                               | `{ field, from, to }` (one event per field; for tags: `{ field: 'tags', from: string[], to: string[] }`) |
| card.blocked / card.unblocked                    | `{ reason? }`                                                                                            |
| card.cancelled                                   | `{ resolution, fromLane }`                                                                               |
| card.reopened                                    | `{ toLane }`                                                                                             |
| card.archived                                    | `{}`                                                                                                     |
| comment.added / comment.edited / comment.deleted | `{ commentId, parentCommentId? }`                                                                        |
| attachment.added / attachment.removed            | `{ attachmentId, filename }`                                                                             |
| card.pii_deleted                                 | `{ scope }` tombstone                                                                                    |

### sessions

Server-side web sessions ([ADR-009](decisions/ADR-009-sessions-and-tokens.md)):
`id (random 256-bit, stored sha256-hashed), user_id FK, created_at, expires_at, last_seen_at`.
Cookie holds the raw id; lookup is by hash. Sliding expiry (`last_seen_at` bumped at most once
per 5 minutes), absolute cap 30 days. A fresh id is issued at every login; password change,
role change, and deactivation revoke the user's other sessions.

### service_tokens

MCP/automation credentials: `id, name, token_hash (sha256, UNIQUE — credential uniqueness is
a schema invariant and the index behind the per-request bearer lookup), role (a role KEY, `text`,
validated against the active policy at write time — no enum), scope ('read' |
'read_write'), created_by FK, created_at, last_used_at, revoked_at NULL`. Managed via
`manageTokens`; the
raw token (`rkb_` + 32 random bytes base64url, 256-bit CSPRNG — the prefix makes leaked tokens
fingerprintable by secret scanners) is shown once at creation. Tokens never expire; revocation
(`revoked_at`) is the only lifecycle end, and rows are never deleted so audit `actor_id`
resolution survives. The `scope` is an always-on identity rule (like comment authorship):
`read` tokens cannot call any mutating tool regardless of policy configuration.

## Ordering keys

`cards.position` is a base-62 fractional key (`fractional-indexing` algorithm). The server
generates `generateKeyBetween(prev, next)` **inside the move transaction** from client-sent
neighbor ids — clients never compute keys, which eliminates concurrent-duplicate races.
`UNIQUE(lane_id, position)` backstops; on violation the transaction retries once with re-read
neighbors. A daily job rebalances lanes whose keys exceed 100 chars.
([ADR-006](decisions/ADR-006-fractional-ordering.md))

## Optimistic locking

Field-mutating commands carry `expectedVersion`; REST maps it to `If-Match`/ETag. Mismatch =
`409 Conflict` + current state. Moves also carry it (drag on a stale card must not silently
override a concurrent edit). ([ADR-012](decisions/ADR-012-optimistic-locking.md))

## Seeding

Two distinct layers (see deployment.md for the production bootstrap):

- **Structural seed** — runs idempotently on every boot, all environments: the board, the 7
  lanes (with the seeded WIP limits), the `DEFAULT_POLICY_DOCUMENT` (enforcement off, the 7-lane
  graph, and a `roles` array of `user` + `admin` — see ADR-013), and the `system` user. The app
  cannot function without these. It inserts **no locations**: a fresh install (and production)
  starts with an empty locations table, so the first-boot "Add your locations" setup step — and
  production — are never pre-populated.

  Caveat: an existing dev DB seeded under the OLD policy-document shape must be RESET — the old
  JSON (`actionGates`, per-transition `minRole`, fixed `user | admin` enum) no longer parses
  against the roles-as-data schema.

- **Demo seed** — only when `SEED_DEMO_DATA=true` (refused outright in production mode): the
  sample location tree (buildings → floors → rooms), demo users for each role (printed
  credentials), sample cards in every lane including blocked, overdue-waiting, cancelled, and
  archived examples (some pointing at a seeded room). This is the canonical fixture dataset used
  by dev boot, integration tests, and Playwright alike.

## Lifecycle & retention

- Done cards: `archived_at` after 90 days; excluded from board queries, included in history.
- `card_events` grows unbounded by design; the indexes above are the day-one mitigation, table
  partitioning/archival is a Postgres-era concern.
- PII deletion (approved requests only): hard-delete comments/fields/attachments + tombstone
  event. Blobs are deleted from the store; `attachments` rows keep filename metadata unless the
  request covers those too.
