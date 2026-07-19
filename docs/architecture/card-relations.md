# Card relations

Cards can be linked to one another with **typed relations** — "this blocks that", "this duplicates
that", "these relate". Relations are metadata shown **only in the card detail panel**, never on board
card previews (they would clutter the dense board and aren't needed to triage a lane). This document
is the human-first spec for the shape, the rules, and where it lives.

## The relation types

A deliberately small, researched set (the common core of Linear / GitHub / Jira, minus the rarely
used `clones`/`fixes`). A relation is stored as **one directed row** (`from → to`) with a type; the
other card renders the **inverse**.

| Type         | Direction   | `from` card reads | `to` card reads   | Meaning                                            |
| ------------ | ----------- | ----------------- | ----------------- | -------------------------------------------------- |
| `blocks`     | directional | **Blocks**        | **Blocked by**    | the operational dependency between work orders     |
| `duplicates` | directional | **Duplicates**    | **Duplicated by** | this card is the same work as another              |
| `relates_to` | symmetric   | **Relates to**    | **Relates to**    | a generic association — no inverse, same both ways |

`RELATION_TYPES` and the directionality live in core (`packages/core/src/domain/relations.ts`); the
human labels live in the web strings (`relations.labels[type][direction]`), the single source the UI
reads.

## Rules

- **No self-relation.** A card cannot relate to itself (`409`).
- **No duplicates.** The same directed `(from, to, type)` twice is a conflict (`409`), enforced by a
  composite `UNIQUE` index. For a **symmetric** type the reverse row counts as the same relation, so
  `A relates B` also blocks `B relates A`. Directional types are independent per direction —
  `A blocks B` and `B blocks A` are two different (if contradictory) relations, left to the user.
- **Both cards must exist.** An unknown target is a `404`.
- **Deletable from either side.** A relation touches two cards; removing it from either card's panel
  deletes the single row. A delete scoped to a card the relation does not touch is a `404`.
- **Who may manage them.** Managing relations is collaborative card metadata available to **any
  authenticated user** (like adding a comment) — there is no `manage*` RBAC gate; the routes sit
  behind the normal web-session gate.
- **v0 scope.** Relations do **not** yet append to the card audit trail (`card_events`) or fan out
  over SSE — a link carries no lifecycle weight, and cross-user liveness is a deliberate follow-up
  (the acting client refetches its own list). Cards are never hard-deleted, so a relation never
  dangles.

## Data model

`card_relations` (`packages/db`), one row per directed relation:

| Column         | Type         | Notes                                    |
| -------------- | ------------ | ---------------------------------------- |
| `id`           | UUIDv7       |                                          |
| `from_card_id` | integer FK   | the `from` card (ticket number)          |
| `to_card_id`   | integer FK   | the `to` card                            |
| `type`         | text         | `blocks` \| `duplicates` \| `relates_to` |
| `created_at`   | ISO-8601 UTC |                                          |

Indexes: `UNIQUE(from_card_id, to_card_id, type)` (the no-duplicate backstop) plus a plain index on
each of `from_card_id` and `to_card_id` — `listByCard` is `WHERE from_card_id = ? OR to_card_id = ?`,
and SQLite OR-unions the two.

## API

All scoped to a card by its ticket number; every route is behind the session gate.

| Method & path                        | Body                 | Response               | Description                           |
| ------------------------------------ | -------------------- | ---------------------- | ------------------------------------- |
| `GET /cards/:id/relations`           | —                    | `200` `RelationView[]` | the card's relations, both directions |
| `POST /cards/:id/relations`          | `{ toCardId, type }` | `201` `RelationView`   | link `:id` (`from`) to `toCardId`     |
| `DELETE /cards/:id/relations/:relId` | —                    | `204`                  | remove (must touch `:id`, else `404`) |

A **`RelationView`** resolves a stored row FROM the requesting card's perspective:
`{ id, type, direction: 'outgoing' | 'incoming', card: { id, title } }`, where `card` is always the
OTHER card. `outgoing` = the requesting card is `from` (reads the forward label); `incoming` = it is
`to` (reads the inverse). The client picks the label from `(type, direction)`.

## Frontend

`packages/web/src/card/RelationsSection.tsx`, rendered in the detail panel's **Details** tab (below
Attachments). It lists each related card with the relationship as seen from the open card, links
through to the other card (preserving the board filter query in the URL), and — unless the card is
archived (read-only) — offers an **add row**: a relationship-type select plus an **async card search**
that reuses `GET /cards?q=` (title / ticket-number substring), excluding the current card and any
already-related one. Relations are **never** rendered on board card previews.
