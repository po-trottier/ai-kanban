# ADR-012: Optimistic locking with a version column, in the contract from v1

**Status**: accepted (2026-07-16)

## Context

Multiple dispatchers will edit the same card while SSE keeps everyone's view fresh-ish. Without
concurrency control, last-write-wins silently destroys edits. Retrofitting `expectedVersion`
later would break all three consumer types at once.

## Decision

- `cards.version` INTEGER, incremented on every mutation inside the transaction.
- Every field-mutating command (PATCH, move, cancel, block…) requires `expectedVersion` —
  REST expresses it as `If-Match`/ETag; MCP tools take it as a parameter; Slack flows read the
  fresh version inside their own transaction.
- Mismatch → **409 Conflict** with the current resource state in the body. The SPA rolls back
  its optimistic update, refetches, and shows a non-blocking "card was just updated by someone
  else" toast.
- **No field-level merge** (KISS): conflicts at kanban scale are rare; refetch-and-redo is the
  honest UX. Comments are append-only and need no locking.

## Consequences

Every write path and every client must thread the version through — enforced by the shared Zod
schemas making `expectedVersion` required. E2E coverage includes a real two-session conflict.
