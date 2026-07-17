# ADR-008: SSE for realtime board sync (not WebSockets)

**Status**: accepted (2026-07-16)

## Context

Concurrent users must see each other's changes without refresh. All client→server communication
already flows through REST; the only missing piece is server→client invalidation.

## Decision

- **Server-Sent Events** at `GET /api/v1/stream`, fed by the in-process EventBus.
- Events are invalidation hints, not data — clients refetch via REST, so authorization and
  serialization exist in exactly one place.
- **Hint catalog** (a Zod discriminated union):
  - Card-scoped: `{ type, cardId, version, eventId }` where `type` is the card_events
    `event_type` (`card.*`, `comment.*`, `attachment.*`) and `eventId` is the audit event's
    UUIDv7. The client invalidates that card's queries (and the board for moves).
  - Board-scoped (no `cardId`/`version`): `policy.updated`, `lane.updated`, `user.updated`,
    `location.updated` — the client refetches the policy/board/user caches. These exist so an
    admin toggling enforcement changes everyone's drag affordances live.
- A keepalive comment is written every 25 s so idle connections survive proxies.
- Native `EventSource` reconnects automatically; on reconnect the client refetches the board
  (missed events are irrelevant because state is refetched, so no event replay is needed and
  `Last-Event-ID` is best-effort only).
- WebSockets rejected: bidirectional transport, connection upgrade handling, and a second
  auth path — for a feature that needs none of it. SSE rides ordinary HTTP, works with the
  session cookie, and degrades gracefully.

## Consequences

Reverse proxies must not buffer the stream (documented in deployment.md). The EventBus is a
port: the in-process implementation assumes one Node process and swaps to Postgres
LISTEN/NOTIFY at the multi-instance migration. SSE client count is a Prometheus gauge, and
each user is capped at 5 concurrent streams (security.md). Hint broadcast assumes universal
read visibility — every authenticated user may see every card; if a future policy version adds
visibility gates, the SSE adapter must gain per-connection filtering in the same change.
