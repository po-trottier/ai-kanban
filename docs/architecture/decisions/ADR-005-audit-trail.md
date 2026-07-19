# ADR-005: Append-only audit trail written in the same transaction as every mutation

**Status**: accepted (2026-07-16)

## Context

Requirement: track every state change for every job, uniformly across web, MCP, and Slack
actors. Retrofitting per-field history onto live data is painful and error-prone, so this must
exist from the first commit.

## Decision

- One `card_events` table, append-only (no UPDATE/DELETE ever; PII removal adds a tombstone
  event and hard-deletes the _source_ rows, not events).
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

## Addendum: discarding an intake draft (2026-07-19)

One intentional exception to "no DELETE ever": a card's creator may hard-delete (discard) their
own card **while it is still in the intake lane** (`CardService.delete`, owner-only, gated on the
intake lane). The cascade removes the card and every FK-referencing row — including its
`card_events` — in one transaction, so that card's (short) event trail is erased with it. This is
a bounded exception, not a hole in the invariant: an un-progressed intake draft has no audit
history worth preserving, and the gate (owner + still in intake) means nothing that has moved
through the workflow can ever be erased. No tombstone event is written (there is no card to point
one at).
