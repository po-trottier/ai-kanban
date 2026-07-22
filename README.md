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
  Point an agent at the running app and it self-serves setup from `/llms.txt` — the human pastes
  the token into their own config, never into the chat (see [MCP server](docs/architecture/mcp.md)).
- **Slack**: create tickets from any thread via a message shortcut or @-mention, with optional
  AI thread summarization (human always reviews).
- **Storage**: pluggable behind repository ports — SQLite (WAL) by default for single-node and
  development, PostgreSQL for production/multi-node (selected via `DATABASE_URL`); see
  [ADR-020](docs/architecture/decisions/ADR-020-postgresql-support.md).

## Documentation

- [Changelog](CHANGELOG.md) — release notes ([Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format)
- **Users**
  - [User guide](docs/user/guide.md) — using the board, cards, comments, history
  - [Slack guide](docs/user/slack.md) — creating tickets from Slack threads
- **Product**
  - [Vision & scope decisions](docs/product/vision.md)
  - [Workflow: lanes, transitions, policies](docs/product/workflow.md)
- **Architecture**
  - [Overview](docs/architecture/overview.md) — hexagonal design, monorepo, process model
  - [Data model](docs/architecture/data-model.md)
  - [REST API](docs/architecture/rest-api.md)
  - [Board filters](docs/architecture/board-filters.md) — filter bar facets, presets, API-level filtering
  - [MCP server](docs/architecture/mcp.md)
  - [Slack integration](docs/architecture/slack.md)
  - [Security](docs/architecture/security.md)
  - [Deployment](docs/architecture/deployment.md)
  - [Decision records (ADRs)](docs/architecture/decisions/)
- **Developers**
  - [Getting started](docs/dev/getting-started.md)
  - [Engineering standards (enforced)](docs/dev/standards.md)
  - [Testing standards (enforced)](docs/dev/testing.md)

## Quick start

```bash
npm ci && npm run setup && cp .env.example .env && npm run dev
```

## License

Copyright © 2026 Pierre-Olivier Trottier.

Licensed under the [PolyForm Strict License 1.0.0](LICENSE) — in short:

| Activity                             | Public permission     |
| ------------------------------------ | --------------------- |
| View the source                      | Yes                   |
| Run the original software personally | Yes                   |
| Noncommercial use                    | Yes                   |
| Modify the code                      | No                    |
| Publish modifications                | No                    |
| Redistribute copies                  | No                    |
| Incorporate it into another project  | No                    |
| Commercial or business use           | No                    |
| Obtain additional rights             | By separate agreement |

The table is a summary only; the [LICENSE](LICENSE) text governs.

## Tech stack

- **Language**: TypeScript end-to-end (one Zod schema source for REST, OpenAPI, MCP, and forms)
- **Backend**: Node 24 LTS, Fastify 5, Drizzle ORM (better-sqlite3 WAL, or PostgreSQL via `pg`),
  SSE realtime
- **MCP**: official `@modelcontextprotocol/sdk` (Streamable HTTP at `/mcp`)
- **Slack**: Bolt (Socket Mode), OpenAI-compatible API (any OpenAI-compatible endpoint) for optional thread summarization
- **Frontend**: React 19, Vite, Pragmatic drag-and-drop, TanStack Query, Mantine 9 (ADR-016)
- **Testing**: Vitest (unit + no-mock integration), Playwright (e2e)
