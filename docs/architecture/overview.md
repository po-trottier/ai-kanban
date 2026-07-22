# Architecture Overview

## System context

```
                 ┌────────────────────────── one Node process ──────────────────────────┐
                 │                                                                       │
 Browser (SPA) ──┤ REST /api/v1 ─┐                                                      │
                 │ SSE /api/v1/stream ─┐                                                │
 MCP clients ────┤ MCP  /mcp ────┤     │                                                │
 (AI agents)     │               ▼     ▼                                                │
                 │        ┌──────────────────┐      ┌──────────────┐                    │
 Slack ──────────┤ Bolt   │  core services   │─────▶│  ports       │──▶ Drizzle/SQLite  │
 (Socket Mode)   │ agent  │  (framework-free)│      │ (interfaces) │──▶ blob dir        │
                 │        └──────────────────┘      └──────────────┘──▶ Slack Web API   │
                 │               ▲                                  ──▶ LLM provider    │
                 │        croner jobs (aging alerts, archival, rebalance)               │
                 └───────────────────────────────────────────────────────────────────────┘
```

Three **inbound adapters** — REST routes, MCP tool handlers, Slack Bolt listeners — are thin
translation layers over one shared, framework-free **core** package. Business rules (the
configurable permission policy, opt-in transition rules, audit writes, ordering) exist exactly
once, in core services; no adapter can bypass them. Outbound dependencies (database, blob storage, Slack client, LLM, clock, id
generation, notifications, event bus) are **ports**: TypeScript interfaces owned by core, each
with one production adapter and, where useful, an in-memory fake for unit tests.

This is the hexagonal (ports-and-adapters) pattern; see
[ADR-004](decisions/ADR-004-hexagonal-architecture.md).

## Monorepo layout (npm workspaces)

```
packages/
  core/     # entities, Zod schemas, ports, policy engine (configurable permissions + transition rules), services. No framework imports.
  db/       # Drizzle schema + migrations + repository adapters implementing core ports (only package allowed to import better-sqlite3)
  server/   # composition root: Fastify app, REST routes, MCP mount, Slack Bolt adapter, SSE, jobs, static SPA serving
  web/      # React SPA (Vite)
e2e/        # Playwright suite (drives real server + real browser)
docs/
```

Dependency rules (machine-enforced by dependency-cruiser, see
[dev/standards.md](../dev/standards.md)):

- `core` imports nothing from other packages and no framework/IO libraries.
- `db` imports `core` (to implement its ports). Only `db` may import `better-sqlite3` or
  `drizzle-orm`.
- `server` imports `core` and `db` (wiring only); routes/tools/listeners call core services,
  never repositories directly.
- `web` talks to the server over HTTP only; it shares Zod schemas via `core` (type-only + schema
  imports are its single allowed cross-package dependency).

## Process model

Exactly **one Node process** while on SQLite (single-writer model). It hosts Fastify (REST, MCP,
SSE, static SPA), the Bolt Socket Mode client (outbound WebSocket to Slack — no inbound
endpoint), and the croner in-process scheduler. On the Postgres backend (selected via
`DATABASE_URL`) the same process model applies; multi-instance deployment is a still-future move,
and the EventBus and scheduler are ports precisely so that move swaps them (Postgres LISTEN/NOTIFY,
external job queue) without touching core.

## Request lifecycle (example: drag a card)

1. SPA sends `POST /api/v1/cards/:id/move` with header `If-Match: "<version>"` and body
   `{ toLane, prevCardId, nextCardId }` (the route maps If-Match to the core command's
   `expectedVersion`).
2. Route handler validates the body against the shared Zod schema, resolves the session to an
   `Actor { userId, role, kind: 'user' }`, and calls `cardService.move(actor, cmd)`.
3. `CardService` — in one transaction via the unit-of-work port — checks the policy engine
   (configured permission policy + lane-entry data rules + optimistic lock), computes the fractional position key from the
   neighbors, updates the card, bumps `version`, and appends the audit event
   (`card.status_changed` or `card.reordered`).
4. On commit, the service publishes a domain event to the EventBus; the SSE adapter fans it out
   to connected browsers; TanStack Query on other clients invalidates and refetches.
5. The route serializes the updated card through the response schema. A stale `expectedVersion`
   short-circuits at step 3 into a `409 Conflict` carrying the current card state.

The same `cardService.move` is what the MCP `move_card` tool and any Slack action call — with
their own `Actor` (`kind: 'mcp' | 'slack'`), so audit entries always record who did what from
where.

## Realtime

Server-Sent Events (`GET /api/v1/stream`), fed by the in-process EventBus. Events are
lightweight invalidation hints, not data payloads — the client refetches through the normal
REST path, keeping one serialization/authorization code path (the full hint catalog is in
[ADR-008](decisions/ADR-008-sse-realtime.md)). Clients auto-reconnect (native `EventSource`)
and refetch the board on reconnect.
WebSockets were rejected for v1: nothing here needs client→server push, and SSE degrades and
proxies more simply ([ADR-008](decisions/ADR-008-sse-realtime.md)).

## Scheduled jobs (croner, in-process)

| Job                  | Schedule | Action                                                                           |
| -------------------- | -------- | -------------------------------------------------------------------------------- |
| Waiting aging alerts | hourly   | Slack-DM assignee + active admins once per overdue episode (`resume_alerted_at`) |
| Done archival        | daily    | set `archived_at` on cards Done > 90 days                                        |
| Position rebalance   | daily    | rewrite fractional keys in lanes where key length exceeds threshold              |
| Session purge        | daily    | delete sessions past `expires_at` / the absolute cap                             |
| SQLite snapshot      | nightly  | online backup into a dated snapshot next to Litestream's continuous stream       |

All jobs are idempotent and restart-safe: they derive work from persisted state, never from
in-memory queues, so a missed window is picked up on the next tick.

## Configuration

All configuration comes from environment variables validated by a Zod schema at boot — the
process refuses to start on missing/malformed config. Feature flags: `SLACK_ENABLED`,
`SUMMARIZER_ENABLED`. Secrets (session key, Slack tokens, summarizer LLM key) are env-only: never in
the image, the repo, or logs (pino redaction).

## Deviations from this document

Any implementation change that contradicts this document requires updating the document (and the
relevant ADR) in the same commit. Docs and code review together.
