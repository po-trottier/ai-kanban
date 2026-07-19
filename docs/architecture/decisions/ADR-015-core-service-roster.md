# ADR-015: Core service roster — audit writes are cross-cutting, not a service

**Status**: accepted (2026-07-16); amends the service list in
[ADR-004](ADR-004-hexagonal-architecture.md)

## Context

ADR-004 named an `AuditService` among the core services. Implementing the core package showed
that audit-event writing cannot live in a peer service: ADR-005 requires every event to be
appended **inside the same unit-of-work transaction** as the mutation it records, so the write
belongs to whichever service owns that transaction. A standalone AuditService would either
break the same-transaction guarantee or degenerate into a pass-through.

## Decision

The core service roster is: **CardService, CommentService, AttachmentService,
BoardQueryService, PolicyService** — plus the later feature services **WatchService,
NotificationService, and CardRelationService** (per-card watch subscriptions, the notification
inbox + fan-out, and typed card relations), each following the same rules below.

- Audit-event **writes** are a cross-cutting concern: each mutating service builds events via a
  shared internal helper (validated against the canonical `card_events` schema) and appends
  them through `EventRepository` in its own transaction (ADR-005 unchanged).
- Audit-event **reads** (per-card history, the only v1 query surface) live in
  `BoardQueryService.cardHistory`.
- `PolicyService` (not in ADR-004's list) manages the append-only policy versions from ADR-013.

## Consequences

No behavioral change from ADR-004/ADR-005 — only the decomposition differs. Adapters get one
fewer service to wire; the audit contract is stated in each service method's JSDoc
(docs/dev/standards.md#documentation).
