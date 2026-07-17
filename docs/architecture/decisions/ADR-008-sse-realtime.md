# ADR-008: SSE for realtime board sync (not WebSockets)

**Status**: accepted (2026-07-16)

## Context

Concurrent users must see each other's changes without refresh. All client→server communication
already flows through REST; the only missing piece is server→client invalidation.

## Decision

- **Server-Sent Events** at `GET /api/v1/stream`, fed by the in-process EventBus.
- Events are invalidation hints (`{ type, cardId, version, eventId }`), not data — clients
  refetch via REST, so authorization and serialization exist in exactly one place.
- Native `EventSource` reconnects automatically; on reconnect the client refetches the board
  (missed events are irrelevant because state is refetched, so no event replay is needed and
  `Last-Event-ID` is best-effort only).
- WebSockets rejected: bidirectional transport, connection upgrade handling, and a second
  auth path — for a feature that needs none of it. SSE rides ordinary HTTP, works with the
  session cookie, and degrades gracefully.

## Consequences

Reverse proxies must not buffer the stream (documented in deployment.md). The EventBus is a
port: the in-process implementation assumes one Node process and swaps to Postgres
LISTEN/NOTIFY at the multi-instance migration. SSE client count is a Prometheus gauge.
