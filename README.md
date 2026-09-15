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
- **Storage**: SQLite (WAL) for development, PostgreSQL for production (selected via
  `DATABASE_URL`). Deploy one app container; see
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

## Deploy with Docker

Requires a Linux AMD64 Docker host with Docker Compose v2. The stack runs the published
`ghcr.io/po-trottier/ai-kanban:latest` image and PostgreSQL 17; Node.js and a local build are
not required on the server.

```bash
git clone https://github.com/po-trottier/ai-kanban.git rivian-kanban
cd rivian-kanban
cp .env.example .env
```

Edit `.env` before starting:

- `POSTGRES_PASSWORD`: replace `change-me` with a long random alphanumeric password.
- `PUBLIC_BASE_URL`: your public HTTPS URL, or `http://localhost:3000` for a local trial.
- `TRUST_PROXY`: comma-separated proxy IPs/CIDRs as seen by the app; leave empty for direct access.
- Keep `SEED_DEMO_DATA=false` and `SEED_DEMO_PASSWORD` unset.

The published image supports anonymous pulls; no GitHub token is required:

```bash
docker compose config --quiet
docker compose pull
docker compose up -d --wait
docker compose ps
curl --fail http://localhost:3000/readyz
```

Open the app and create the first administrator through the setup page. Put an HTTPS reverse
proxy in front for production access. Database records and uploads persist in the `pgdata`
and `data` named volumes; `docker compose down --volumes` deletes them.

For upgrades, back up both volumes, then run `docker compose pull` and
`docker compose up -d --wait`. `latest` follows the stable GitHub release. Set
`IMAGE_TAG=1.0.1` in `.env` to pin a release, or `sha-<full git SHA>` to pin a commit.
GitHub releases automatically publish matching versioned images after CI passes.
See the [deployment guide](docs/architecture/deployment.md) for
registry access, configuration, backups, rollback, and troubleshooting.

## Local development

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
