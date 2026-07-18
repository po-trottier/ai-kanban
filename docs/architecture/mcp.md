# MCP Server

The MCP server makes the board a first-class surface for AI agents: summaries, "what should we
address first", follow-up nudges, ticket triage. It is **not** a wrapper over the REST API — MCP
tool handlers call the same core services directly, in-process, with a real `Actor`, so policy
checks and audit trail behave identically to web actions.

## Transport & versioning

- `@modelcontextprotocol/sdk` **1.29.x** (stable v1), Streamable HTTP transport in **stateless
  mode** (`sessionIdGenerator: undefined`): one transport per request, `POST /mcp` only — no
  GET stream, no DELETE, no server-initiated messages. This matches the direction of the
  upcoming 2026-07-28 spec release (SEP-2567 removes protocol-level sessions) and keeps the
  mount tiny.
- JSON-RPC **batch bodies are rejected** (`400`, error `-32600`): batching was removed in the
  2025-06-18 spec revision, and one POST = one message keeps the per-token rate limit
  meaningful (a batch would otherwise smuggle many tool calls past one budget unit).
- Mounted on the same Fastify server via a thin raw-request mount (~50 lines). The third-party
  `fastify-mcp-server` plugin is deliberately not used (stale, unlikely to track the transport
  changes). Migration to SDK v2 (`@modelcontextprotocol/server`, official `createMcpHandler`
  Fastify adapter) happens when v2 leaves beta; the mount is the only file that should change.
  ([ADR-010](decisions/ADR-010-mcp-sdk-pin.md))

## Authentication

Bearer service tokens from day one — `/mcp` is never anonymous. Tokens are admin-created,
sha256-hashed at rest, revocable, and audited (`actor_kind: 'mcp'`, `actor_id: <token id>`).
Missing/invalid tokens get `401` + `WWW-Authenticate: Bearer`. Rate-limited **per token id**
(agents often share egress IPs).

The stored `actor_id` stays the token id (audit integrity), but read paths that return events —
`get_card_history`, `list_activity`, and the REST `GET /cards/:id/events` and `GET /events` —
enrich each `mcp` event at read time with two derived, optional fields: `actorLabel` (the token
name) and `onBehalfOfUserId` (the token's `createdBy`), so surfaces render "<token> on behalf
of <user>" instead of an opaque id.

The **activity feed** (`list_activity` / `GET /events`) resolves ids to names one step further,
in a shape shared by both surfaces and defined once in core (`activityFeedSchemaOf`): each item
also carries `actorDisplayName` (user/slack actors) and `onBehalfOfDisplayName` (the mcp
on-behalf user), and the envelope adds a top-level `users` map (`{ id, displayName, email }`)
covering **every** user id the page references — actors, on-behalf users, and each
`card.created` snapshot's `reporterId`/`assigneeId`. The map is batch-resolved with one users
read per page (no N+1). The per-card `get_card_history` / `GET /cards/:id/events` payload keeps
its existing shape (the card panel owns it) — only the feed carries the map and display names.

Each token carries:

- a **scope** — `read` (default in the admin UI) or `read_write`. Scope is an always-on
  identity rule: `read` tokens cannot call mutating tools no matter how permissive the policy
  is. Give reporting/summarizer agents `read` tokens.
- a **role** — referenced by policy gates; under the default permissive policy it imposes
  nothing (it starts mattering when an admin enables gates).

Token format: `rkb_` + 32 random bytes base64url (256-bit CSPRNG; the prefix makes leaks
scanner-detectable). Shown once at creation, never expires, revocation is the only end.

Full OAuth 2.0 resource-server behavior (RFC 9728 protected-resource metadata, IdP-issued
tokens) arrives with the OIDC/SSO cutover; service tokens remain for headless automation.

## Connecting a client

1. **Mint a token.** In the app: **Settings → Service tokens → New token** (pick `read` for
   summarizers, `read_write` for agents that act). Headless: `POST /api/v1/service-tokens` with
   `{ name, role, scope }` as an admin. The raw `rkb_…` value is shown once — copy it then.
2. **Point the client at `POST <host>/mcp`** (Streamable HTTP, stateless — no separate
   handshake endpoint) with header `Authorization: Bearer rkb_…`.

A typical MCP client config:

```json
{
  "mcpServers": {
    "rivian-kanban": {
      "url": "https://<host>/mcp",
      "headers": { "Authorization": "Bearer rkb_your_token_here" }
    }
  }
}
```

Smoke-test with the MCP Inspector — Transport **Streamable HTTP**, URL `<host>/mcp`, header
`Authorization: Bearer rkb_…`, then **Connect → List Tools**:

```
npx @modelcontextprotocol/inspector
```

## Tools

Input/output schemas are the same Zod schemas the REST API uses, exposed as JSON Schema. All
listing tools accept the same filters and cursors as REST.

| Tool                 | Maps to             | Notes                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_board_snapshot` | BoardQueryService   | lanes with card counts, WIP status, blocked counts, oldest-card ages — the "state of the shop" call                                                                                                                                                                                                                                                                             |
| `list_cards`         | card list           | same filters as `GET /cards`: lane, assignee, reporter, priority, tag, blocked, waitingReason, overdueResume, q (title+description substring), includeArchived                                                                                                                                                                                                                  |
| `get_card`           | card detail         | includes tags, location, attachment metadata, latest events, full comment thread (soft-deleted bodies blanked, exactly like REST)                                                                                                                                                                                                                                               |
| `get_card_history`   | events              | audit trail, oldest-first, filterable by event type                                                                                                                                                                                                                                                                                                                             |
| `list_stale_cards`   | BoardQueryService   | cards past `expected_resume_at`, in review > `reviewDays` (default 7), or blocked > `blockedDays` (default 3) — the follow-up feed; defaults stated in the tool description                                                                                                                                                                                                     |
| `list_activity`      | BoardQueryService   | board-wide activity feed: card events, newest-first, cursor-paginated; filters (all optional) `sinceIso` (default 24h ago), `type`, `cardId`, `actorKind`. Gated on `viewAllActivity` — without it the caller sees only its OWN activity (see below). Items carry `actorLabel`/`onBehalfOfUserId` + `actorDisplayName`/`onBehalfOfDisplayName`; the envelope adds a `users` map |
| `list_lanes`         | BoardQueryService   | the board's lanes in board order (`id, key, label, position, wipLimit`)                                                                                                                                                                                                                                                                                                         |
| `list_locations`     | LocationService     | the location tree as a flat `parentId`-linked list (`id, kind, name, parentId`) — resolve an id before setting `card.locationId` (that field takes an id, not a name)                                                                                                                                                                                                           |
| `list_tags`          | BoardQueryService   | every tag in use (`id, name`) — reuse an existing name when tagging instead of coining near-duplicates                                                                                                                                                                                                                                                                          |
| `list_blocked_cards` | card list           | thin `blocked=true` slice of `list_cards`, newest-first, cursor-paginated                                                                                                                                                                                                                                                                                                       |
| `whoami`             | ServiceToken read   | the calling token's own `{ id, name, role, scope, createdAt, lastUsedAt }` (any token inspects itself; the hash is never returned)                                                                                                                                                                                                                                              |
| `create_card`        | CardService.create  | same schema as `POST /cards`; lands in intake, origin `mcp`; optional `reporterEmail` resolves the reporter (active accounts only; unknown and deactivated emails fail identically), otherwise the seeded `system` user                                                                                                                                                         |
| `update_card`        | CardService.update  | requires `expectedVersion` like REST                                                                                                                                                                                                                                                                                                                                            |
| `move_card`          | CardService.move    | same configurable permission policy as REST                                                                                                                                                                                                                                                                                                                                     |
| `comment_on_card`    | CommentService      | supports `parentCommentId` replies                                                                                                                                                                                                                                                                                                                                              |
| `cancel_card`        | CardService.cancel  | cancel a non-terminal card into `done` with a resolution; `expectedVersion` + `read_write`                                                                                                                                                                                                                                                                                      |
| `reopen_card`        | CardService.reopen  | reopen a `done`/cancelled/archived card back to `ready`; `expectedVersion` + `read_write`                                                                                                                                                                                                                                                                                       |
| `archive_card`       | CardService.archive | archive a `done` card (reversible via reopen); `expectedVersion` + `read_write`                                                                                                                                                                                                                                                                                                 |
| `block_card`         | CardService.block   | raise the blocked flag with a `reason`; `expectedVersion` + `read_write`                                                                                                                                                                                                                                                                                                        |
| `unblock_card`       | CardService.unblock | clear the blocked flag; `expectedVersion` + `read_write`                                                                                                                                                                                                                                                                                                                        |

Write tools (`create_card`, `update_card`, `move_card`, `comment_on_card`, `cancel_card`,
`reopen_card`, `archive_card`, `block_card`, `unblock_card`) are registered on the guarded
write path: a `read`-scope token is denied by the always-on identity rule (`token-scope-read`)
before any service runs, and the core service independently re-denies it via `evaluatePolicy`.
The remaining tools are reads. Reads are not write-gated, but `list_activity` carries one READ
gate — see below; every other read is available to any authenticated token.

Each tool declares MCP behaviour hints (`ToolAnnotations`) so clients render them correctly
instead of inheriting the SDK's pessimistic defaults: reads are `readOnly` / non-destructive /
idempotent; writes flip `readOnly` off, with `destructive` set only on the lifecycle terminals
`cancel_card` / `archive_card` (reversible via reopen) and `idempotent` cleared on the append
actions `create_card` / `comment_on_card` (each call adds a row). `openWorldHint` is false
everywhere — no tool reaches an external system.

**Activity-feed access gate.** `list_activity` (and REST `GET /events`) returns the whole board's
cross-user activity only to a caller whose role grants the `viewAllActivity` permission (the
seeded `admin` role does; the `user` role does not) — a READ gate, so it applies to `read`-scope
tokens too (unlike the write rules, a summarizer token CAN hold it). A caller without it is
scoped to its OWN activity: events where the actor is the caller, OR an mcp event by a token the
caller minted (the "on behalf of" line). For an mcp actor the on-behalf user is the token's
`createdBy`, so a token sees its creator's activity. Scoping is pushed into the events query
(`actorIds` allowlist), never filtered in memory, so pagination stays correct.

Design rules:

- Tools are **task-shaped, not table-shaped**: `list_stale_cards` exists because "what needs
  follow-up" is the agent's job; agents should not need to reimplement staleness math.
- Every tool result includes ISO timestamps and ids so agents can chain calls.
- Terminal actions (cancel, reopen, archive, block, unblock) ARE exposed as write tools so a
  write-capable agent can fully drive the lifecycle. They are gated exactly like every other
  write: `read`-scope tokens are denied, each action is audited with the token identity, and
  every one is reversible through history. Give summarizer/reporting agents `read` tokens so
  they can never reach them.

## Threats

Board content (titles, descriptions, comments) is written by any authenticated user and
returned verbatim to agents — treat it as **untrusted input**: a hostile insider can plant
instructions aimed at a write-capable agent ("move all P0 cards to Done…"). Mitigations, in
order: issue `read` tokens to any agent that doesn't strictly need writes (which blocks every
write tool, terminal actions included); every agent write is audited with the token identity
and is fully reversible through history. Agent authors should treat user-authored fields as
data, never as instructions.

## Testing

MCP e2e tests use the SDK's own client connected to the real Fastify app in-process (real
temp SQLite, real service tokens): list tools, call each tool against seeded fixtures, assert
`read`-scope tokens are denied on mutating tools, assert policy denials with an enforcement-on
policy fixture (both postures per testing.md), and assert audit events carry
`actor_kind: 'mcp'`.
