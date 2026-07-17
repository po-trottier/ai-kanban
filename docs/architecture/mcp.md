# MCP Server

The MCP server makes the board a first-class surface for AI agents: summaries, "what should we
address first", follow-up nudges, ticket triage. It is **not** a wrapper over the REST API — MCP
tool handlers call the same core services directly, in-process, with a real `Actor`, so policy
checks and audit trail behave identically to web actions.

## Transport & versioning

- `@modelcontextprotocol/sdk` **1.29.x** (stable v1), Streamable HTTP transport, mounted at
  `POST /mcp` on the same Fastify server via a thin raw-request mount (~50 lines).
  The third-party `fastify-mcp-server` plugin is deliberately not used (stale, won't track the
  2026-07-28 spec's transport changes). Migration to SDK v2 (`@modelcontextprotocol/server`,
  official `createMcpHandler` Fastify adapter) happens when v2 leaves beta; the mount is the
  only file that should change. ([ADR-010](decisions/ADR-010-mcp-sdk-pin.md))

## Authentication

Bearer service tokens from day one — `/mcp` is never anonymous. Tokens are admin-created,
role-scoped (`requester|technician|supervisor|admin`), sha256-hashed at rest, revocable, and
audited (`actor_kind: 'mcp'`, `actor_id: <token id>`). Missing/invalid tokens get
`401` + `WWW-Authenticate: Bearer`. Rate-limited like every other route.

Full OAuth 2.0 resource-server behavior (RFC 9728 protected-resource metadata, IdP-issued
tokens) arrives with the OIDC/SSO cutover; service tokens remain for headless automation.

## Tools

Input/output schemas are the same Zod schemas the REST API uses, exposed as JSON Schema. All
listing tools accept the same filters and cursors as REST.

| Tool | Maps to | Notes |
| --- | --- | --- |
| `get_board_snapshot` | BoardQueryService | lanes with card counts, WIP status, blocked counts, oldest-card ages — the "state of the shop" call |
| `list_cards` | card list | filters: lane, assignee, priority, tag, blocked, waiting_reason, overdue-resume, includeArchived |
| `get_card` | card detail | includes tags, location, attachment metadata, latest events, full comment thread |
| `search_cards` | card list `q` | title/description substring search |
| `get_card_history` | events | audit trail, filterable by event type |
| `list_stale_cards` | BoardQueryService | cards past `expected_resume_at`, in review > N days, or blocked > N days — the follow-up feed |
| `create_card` | CardService.create | lands in intake, origin recorded from token |
| `update_card` | CardService.update | requires `expectedVersion` like REST |
| `move_card` | CardService.move | full transition-matrix + role enforcement |
| `comment_on_card` | CommentService | supports `parentCommentId` replies |

Design rules:
- Tools are **task-shaped, not table-shaped**: `list_stale_cards` exists because "what needs
  follow-up" is the agent's job; agents should not need to reimplement staleness math.
- Every tool result includes ISO timestamps and ids so agents can chain calls.
- Destructive/terminal actions (cancel, reopen) are deliberately **not** exposed as MCP tools in
  v1; agents recommend, humans execute. Revisit with usage evidence.

## Testing

MCP e2e tests use the SDK's own client connected to the real Fastify app in-process (real
temp SQLite, real service tokens): list tools, call each tool against seeded fixtures, assert
policy denials for under-privileged tokens, assert audit events carry `actor_kind: 'mcp'`.
