# ADR-005: Append-only audit trail written in the same transaction as every mutation

**Status**: accepted (2026-07-16)

## Context

Requirement: track every state change for every job, uniformly across web, MCP, and Slack
actors. Retrofitting per-field history onto live data is painful and error-prone, so this must
exist from the first commit.

## Decision

- One `card_events` table, append-only (no UPDATE/DELETE ever; PII removal adds a tombstone
  event and hard-deletes the *source* rows, not events).
- Services write the event **inside the same unit-of-work transaction** as the mutation — a
  mutation without its event cannot be observed, even across a crash.
- Distinct event types per concern (`card.status_changed` vs `card.reordered` vs
  `card.field_changed` …) so status history is never polluted by reorder noise. Field edits
  emit one event per changed field with `{ field, from, to }`.
- Every event records `actor_id` + `actor_kind (user | mcp | slack | system)`.

## Alternatives rejected

- DB triggers: hide the rule from the domain layer and diverge across dialects.
- Event-sourcing (events as source of truth): power we don't need; state tables + event log
  gives the queryability without the rebuild machinery (KISS).
- Post-commit/async event writing: loses the atomicity guarantee that makes the trail trustworthy.

## Consequences

Repositories expose mutation + event-append under one UnitOfWork. The table grows unbounded by
design; day-one indexes `(card_id, created_at)` and `(event_type, created_at)` keep it
queryable, and archival/partitioning is deferred to the Postgres era.
