# Data Model

Drizzle ORM schema, SQLite dialect today. Portability rules (enforced, see
[dev/standards.md](../dev/standards.md)): conservative column types only (TEXT, INTEGER, REAL),
ISO-8601 UTC strings for timestamps, TEXT ids (UUIDv7), no SQLite-only features outside the
`db` package. The Postgres port is a one-time mechanical `sqlite-core` → `pg-core` schema
rewrite behind unchanged repository ports ([ADR-003](decisions/ADR-003-drizzle-sqlite.md)).

## Entity-relationship sketch

```
users ─┬────────────< cards >────────────┬─ lanes >── boards
       │  (reporter, assignee)           │
       │                                 ├──< card_tags >── tags
       ├──< comments >── cards           ├──< comments (threaded via parent_comment_id)
       ├──< attachments >── cards        ├──< attachments
       └──< card_events >── cards        └── locations (optional, tree via parent_id)
sessions >── users        service_tokens (MCP)
```

## Tables

### users
| column | type | notes |
| --- | --- | --- |
| id | TEXT PK | UUIDv7 |
| email | TEXT UNIQUE NOT NULL | lowercased |
| display_name | TEXT NOT NULL | |
| role | TEXT NOT NULL | `requester \| technician \| supervisor \| admin` |
| password_hash | TEXT NOT NULL | argon2id |
| slack_user_id | TEXT NULL | resolved lazily by email when Slack is enabled |
| is_active | INTEGER NOT NULL | soft-disable; inactive users cannot log in but remain referenced |
| created_at | TEXT NOT NULL | ISO-8601 UTC |

### boards
Single seeded row in v1; cards reference it so multi-board is additive later.
`id, name, created_at`.

### lanes
Seeded rows — stable `key`, editable `label` (see [workflow.md](../product/workflow.md)).
| column | type | notes |
| --- | --- | --- |
| id | TEXT PK | |
| board_id | TEXT FK | |
| key | TEXT NOT NULL | machine key, UNIQUE(board_id, key) |
| label | TEXT NOT NULL | display, admin-editable |
| position | INTEGER NOT NULL | board order |
| wip_limit | INTEGER NULL | soft limit |

### locations
Optional tree: `id, parent_id NULL FK, kind ('building'|'floor'|'room'), name`. Seeded,
admin-editable.

### cards
| column | type | notes |
| --- | --- | --- |
| id | TEXT PK | UUIDv7 |
| board_id | TEXT FK NOT NULL | |
| lane_id | TEXT FK NOT NULL | current status |
| position | TEXT NOT NULL | fractional key; UNIQUE(lane_id, position) |
| title | TEXT NOT NULL | ≤ 200 chars |
| description | TEXT NOT NULL DEFAULT '' | markdown |
| priority | TEXT NOT NULL | `P0 \| P1 \| P2` |
| estimate_minutes | INTEGER NULL | |
| reporter_id | TEXT FK NOT NULL | |
| assignee_id | TEXT FK NULL | |
| location_id | TEXT FK NULL | optional (PO decision) |
| origin | TEXT NOT NULL | `manual \| slack \| import \| pm` |
| resolution | TEXT NULL | terminal only: `completed \| cancelled \| declined \| duplicate` |
| blocked | INTEGER NOT NULL DEFAULT 0 | flag, any lane |
| blocked_reason | TEXT NULL | required when blocked=1 |
| blocked_at | TEXT NULL | |
| waiting_reason | TEXT NULL | required in waiting lane: `parts \| vendor \| access \| info \| funding` |
| expected_resume_at | TEXT NULL | required in waiting lane |
| slack_channel_id / slack_thread_ts / slack_permalink | TEXT NULL | source metadata for origin=slack |
| version | INTEGER NOT NULL DEFAULT 1 | optimistic lock ([ADR-012](decisions/ADR-012-optimistic-locking.md)) |
| created_at / updated_at | TEXT NOT NULL | |
| archived_at | TEXT NULL | set by archival job |

Indexes: `(lane_id, position)`, `(board_id, archived_at)`, `(assignee_id)`, `(reporter_id)`.

### tags / card_tags
`tags(id, name UNIQUE COLLATE NOCASE)`; `card_tags(card_id, tag_id, PK(card_id, tag_id))`.
Free-form, created on first use, normalized for per-tag queries.

### comments
| column | type | notes |
| --- | --- | --- |
| id | TEXT PK | |
| card_id | TEXT FK NOT NULL | |
| parent_comment_id | TEXT FK NULL | one level of nesting: replies to a reply attach to the same parent |
| author_id | TEXT FK NOT NULL | |
| body | TEXT NOT NULL | markdown |
| created_at / updated_at | TEXT NOT NULL | |
| deleted_at | TEXT NULL | soft delete keeps thread shape; body rendered as “deleted” |

Index: `(card_id, created_at)`.

### attachments
`id, card_id FK, filename (original, display only), mime, bytes, sha256, storage_key
(random UUID — the blob's name on disk/S3), uploaded_by FK, created_at, deleted_at NULL`.
Binaries live behind the BlobStorePort, never in the database. Index: `(card_id)`.

### card_events — the audit trail
Append-only. Written **in the same transaction** as the mutation it records
([ADR-005](decisions/ADR-005-audit-trail.md)). Never updated or deleted (PII removal is a hard
delete of source rows plus a `card.pii_deleted` tombstone event).

| column | type | notes |
| --- | --- | --- |
| id | TEXT PK | UUIDv7 (time-ordered) |
| card_id | TEXT FK NOT NULL | |
| actor_id | TEXT NULL | user id or service-token id; NULL for `system` |
| actor_kind | TEXT NOT NULL | `user \| mcp \| slack \| system` |
| event_type | TEXT NOT NULL | see below |
| payload | TEXT NOT NULL | JSON, shape per event type |
| created_at | TEXT NOT NULL | |

Indexes: `(card_id, created_at)`, `(event_type, created_at)`.

Event types (distinct so status history is never polluted by reorder noise):

| event_type | payload |
| --- | --- |
| card.created | `{ snapshot }` |
| card.status_changed | `{ fromLane, toLane }` |
| card.reordered | `{ lane, beforeCardId, afterCardId }` |
| card.field_changed | `{ field, from, to }` (one event per field) |
| card.blocked / card.unblocked | `{ reason? }` |
| card.cancelled | `{ resolution, fromLane }` |
| card.reopened | `{ toLane }` |
| card.archived | `{}` |
| comment.added / comment.edited / comment.deleted | `{ commentId, parentCommentId? }` |
| attachment.added / attachment.removed | `{ attachmentId, filename }` |
| card.pii_deleted | `{ scope }` tombstone |

### sessions
Server-side web sessions ([ADR-009](decisions/ADR-009-sessions-and-tokens.md)):
`id (random 256-bit, stored hashed), user_id FK, created_at, expires_at, last_seen_at`.
Cookie holds the raw id; lookup is by hash. Sliding expiry, absolute cap 30 days.

### service_tokens
MCP/automation credentials: `id, name, token_hash (sha256), role, created_by FK, created_at,
last_used_at, revoked_at NULL`. Admin-managed; the raw token is shown once at creation.

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

## Lifecycle & retention

- Done cards: `archived_at` after 90 days; excluded from board queries, included in history.
- `card_events` grows unbounded by design; the indexes above are the day-one mitigation, table
  partitioning/archival is a Postgres-era concern.
- PII deletion (approved requests only): hard-delete comments/fields/attachments + tombstone
  event. Blobs are deleted from the store; `attachments` rows keep filename metadata unless the
  request covers those too.
