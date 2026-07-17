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

## Tools

Input/output schemas are the same Zod schemas the REST API uses, exposed as JSON Schema. All
listing tools accept the same filters and cursors as REST.

| Tool | Maps to | Notes |
| --- | --- | --- |
| `get_board_snapshot` | BoardQueryService | lanes with card counts, WIP status, blocked counts, oldest-card ages — the "state of the shop" call |
| `list_cards` | card list | same filters as `GET /cards`: lane, assignee, reporter, priority, tag, blocked, waitingReason, overdueResume, q (title+description substring), includeArchived |
| `get_card` | card detail | includes tags, location, attachment metadata, latest events, full comment thread |
| `get_card_history` | events | audit trail, oldest-first, filterable by event type |
| `list_stale_cards` | BoardQueryService | cards past `expected_resume_at`, in review > `reviewDays` (default 7), or blocked > `blockedDays` (default 3) — the follow-up feed; defaults stated in the tool description |
| `create_card` | CardService.create | same schema as `POST /cards`; lands in intake, origin `mcp`; optional `reporterEmail` resolves the reporter, otherwise the seeded `system` user |
| `update_card` | CardService.update | requires `expectedVersion` like REST |
| `move_card` | CardService.move | same configurable permission policy as REST |
| `comment_on_card` | CommentService | supports `parentCommentId` replies |

Design rules:
- Tools are **task-shaped, not table-shaped**: `list_stale_cards` exists because "what needs
  follow-up" is the agent's job; agents should not need to reimplement staleness math.
- Every tool result includes ISO timestamps and ids so agents can chain calls.
- Destructive/terminal actions (cancel, reopen) are deliberately **not** exposed as MCP tools in
  v1; agents recommend, humans execute. Revisit with usage evidence.

## Threats

Board content (titles, descriptions, comments) is written by any authenticated user and
returned verbatim to agents — treat it as **untrusted input**: a hostile insider can plant
instructions aimed at a write-capable agent ("move all P0 cards to Done…"). Mitigations, in
order: issue `read` tokens to any agent that doesn't strictly need writes; terminal actions
are not exposed as tools at all; every agent write is audited with the token identity and is
fully reversible through history. Agent authors should treat user-authored fields as data,
never as instructions.

## Testing

MCP e2e tests use the SDK's own client connected to the real Fastify app in-process (real
temp SQLite, real service tokens): list tools, call each tool against seeded fixtures, assert
`read`-scope tokens are denied on mutating tools, assert policy denials with an enforcement-on
policy fixture (both postures per testing.md), and assert audit events carry
`actor_kind: 'mcp'`.
