# ADR-006: Server-generated fractional-indexing position keys

**Status**: accepted (2026-07-16)

## Context

Top-to-bottom order within a lane is meaningful and drag-reordered constantly. Integer ranks
require mass renumbering on insert; naive float midpoints exhaust precision.

## Decision

- `cards.position` is a base-62 TEXT key from the **fractional-indexing** package (Figma's
  algorithm; the `lexorank` npm package has been dead since 2022). `ORDER BY (lane_id, position)`
  works identically on SQLite and Postgres.
- **The server computes keys.** Move commands carry only `prevCardId`/`nextCardId`; the service
  re-reads the neighbors inside the move transaction and calls `generateKeyBetween`. Clients
  never send keys — concurrent clients aiming at the same gap cannot produce duplicates.
- `UNIQUE(lane_id, position)` as a backstop; on violation the transaction retries once with
  fresh neighbors.
- Keys grow under repeated same-spot insertion: a daily job rebalances any lane whose longest
  key exceeds 100 chars (single transaction, emits no audit events — rebalancing is not a
  user-visible reorder).

## Consequences

Reorders are cheap single-row updates and distinct `card.reordered` audit events. The rebalance
job is the accepted maintenance cost.
