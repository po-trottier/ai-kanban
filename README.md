# Rivian Kanban — Facilities Work-Order Board

A kanban board for facilities project management: a drag-and-drop web UI for humans, an MCP
server for AI agents, and Slack-native ticket intake — all over one audited service layer.

- **Board**: 7 facilities-tuned lanes (Intake → Waiting for Approval → Ready → In Progress →
  Waiting on Parts/Vendor → Review → Done), meaningful top-to-bottom order, P0/P1/P2
  priorities, estimates, tags, locations, attachments, threaded comments.
- **Audit trail**: every state change, field edit, comment, and reorder — by human, agent, or
  bot — is an append-only event.
- **MCP**: AI agents connect to `/mcp` (Streamable HTTP, bearer tokens) and use task-shaped
  tools (`get_board_snapshot`, `list_stale_cards`, …) against the same rules as everyone else.
- **Slack**: create tickets from any thread via a message shortcut or @-mention, with optional
  AI thread summarization (human always reviews).
- **Storage**: SQLite (WAL) today behind repository ports; Postgres is a planned mechanical
  migration, not a rewrite.

## Documentation

| For | Read |
| --- | --- |
| Users | [docs/user/guide.md](docs/user/guide.md) · [docs/user/slack.md](docs/user/slack.md) |
| Product | [docs/product/vision.md](docs/product/vision.md) · [docs/product/workflow.md](docs/product/workflow.md) |
| Architecture | [docs/architecture/overview.md](docs/architecture/overview.md) · [data-model](docs/architecture/data-model.md) · [REST](docs/architecture/rest-api.md) · [MCP](docs/architecture/mcp.md) · [Slack](docs/architecture/slack.md) · [security](docs/architecture/security.md) · [deployment](docs/architecture/deployment.md) · [ADRs](docs/architecture/decisions/) |
| Developers | [docs/dev/getting-started.md](docs/dev/getting-started.md) · [standards](docs/dev/standards.md) · [testing](docs/dev/testing.md) |

## Quick start

```bash
npm ci && cp .env.example .env && npm run dev
```

Stack: TypeScript end-to-end · Fastify 5 · Drizzle + better-sqlite3 · MCP SDK ·
Slack Bolt (Socket Mode) · React 19 + Vite · Pragmatic drag-and-drop · TanStack Query ·
Tailwind 4 + shadcn/ui · Vitest + Playwright.
