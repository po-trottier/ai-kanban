# Getting Started (developers)

## Prerequisites

- Node.js 24 LTS, npm 11+
- Docker (for the production-image integration run and deployment)
- Windows, macOS, or Linux — native modules (better-sqlite3, argon2) build on all three;
  CI additionally verifies the Linux production image.

## Setup

```bash
git clone <repo> && cd rivian-kanban
npm ci
npm run setup             # rebuilds native modules (install scripts are disabled repo-wide) + git hooks
cp .env.example .env      # defaults are enough for local dev; Slack/AI flags default off
npm run dev               # backend :3000 (API+MCP+SSE) + Vite dev server :5173, seeded DB
```

First boot creates `data/app.sqlite`, runs migrations, and seeds the board structure.
Open the app to create the first admin through setup. To load the demo dataset instead,
set `SEED_DEMO_DATA=true` before the first boot. Demo logins are printed to the console —
`admin@demo.rivian-kanban.local` etc., each with a one-time random password minted at that
first boot (dev seed only; never seeded in production mode). Set `SEED_DEMO_PASSWORD` in
`.env` before the first boot for a fixed password instead — that is what the Playwright e2e
harness does for deterministic logins (refused in production, like `SEED_DEMO_DATA`).

## Commands (root)

| Command                                        | What                                                                 |
| ---------------------------------------------- | -------------------------------------------------------------------- |
| `npm run dev`                                  | run backend + frontend in watch mode against `data/app.sqlite`       |
| `npm test`                                     | unit + integration suites                                            |
| `npm run test:unit` / `test:integration`       | one layer                                                            |
| `npm run test:e2e`                             | Playwright (builds web, boots server on a temp DB)                   |
| `npm run lint` / `lint:fix`                    | ESLint + prettier                                                    |
| `npm run check`                                | everything CI runs, locally, in order                                |
| `npm run db:generate`                          | append the next migration from `schema.ts` (see Changing the schema) |
| `npm run db:migrate` / `db:seed` / `db:studio` | drizzle-kit migrate / reseed dev DB / data browser                   |
| `npm run build`                                | compile all packages + SPA bundle                                    |

## Changing the schema

`packages/db/migrations/0000_init.sql` (and its `pg/` twin) is the **frozen v1 baseline** — the
complete schema as it first stabilised. It is **immutable**: never edit or regenerate it. From here
the schema is **forward-only** — a change appends the next incremental migration rather than
rewriting the baseline:

1. Edit `packages/db/src/schema.ts` **and** `packages/db/src/schema.pg.ts` (keep the two twins in
   step — the single-schema rule).
2. Run `npm run db:generate` and `npm run generate:pg -w @rivian-kanban/db`; drizzle diffs the schema against the last
   snapshot and writes the next migration (`0001_*.sql`, `0002_*.sql`, …) for each dialect.
3. Review the generated SQL for data preservation. A table rebuild must copy existing values and
   relationships before dropping the old table, within the migration transaction. No upgrade may
   reset, truncate, or replace user data/settings with seed defaults.
4. Extend `packages/db/src/migration-safety.integration.test.ts` and its populated fixture for new
   persisted entities. Verify older-schema upgrades, repeat startup, and failed-migration rollback
   on both SQLite and PostgreSQL (PGlite).
5. Run `npm run check:migrations` and the tests, then commit the new migration file(s) **in the same
   commit** as the schema change. ALL released SQL, journal entries, and snapshots are immutable;
   the gate compares against the preceding release. New timestamps must strictly increase.

`npm run db:migrate` validates applied history and applies pending SQLite migrations in order;
application startup does the same for either database. A fresh database replays the whole chain.
Never delete an existing data directory to resolve migration failures. Forward migration means
using the original history plus new migrations, not rewriting history to make startup succeed.

## Docker quickstart

The production topology is one compose stack (see
[architecture/deployment.md](../architecture/deployment.md) — THE deployment spec):
`latest` follows the stable GitHub release; set `IMAGE_TAG` to a release version to pin it.

```bash
cp .env.example .env                  # set POSTGRES_PASSWORD, PUBLIC_BASE_URL + TRUST_PROXY,
                                      # plus any Slack/summarizer secrets. Compose itself pins
                                      # NODE_ENV=production and the /data storage paths — dev
                                      # values in .env cannot leak into the container
docker compose pull                  # fetch the tested image from ghcr.io/po-trottier/ai-kanban
docker compose up -d                 # boot; migrations and the structural seed run at boot
curl http://localhost:3000/readyz     # {"status":"ok"} — the same probe the HEALTHCHECK uses
```

For private-package login and pinning a commit with `IMAGE_TAG`, see
[Published image](../architecture/deployment.md#published-image).

Then open the app in a browser: the first boot shows the **setup page**, which creates the
first admin account (see
[deployment.md#bootstrap](../architecture/deployment.md#bootstrap-first-production-deployment)).
The `docker compose exec app node dist/cli.js users create-admin --email you@org.com` command
remains as break-glass recovery if every admin is ever locked out.

The SPA, REST API, MCP mount, and SSE all serve from port 3000; Prometheus metrics live on the
internal 9464 listener that compose deliberately does not publish. Back up PostgreSQL and
the uploads volume as described in [Database operations](../architecture/deployment.md#database-operations).
Litestream applies only to the optional SQLite deployment; Compose has no backup profile.
To run the integration suite inside the production image exactly like CI:

```bash
docker build --target test -t rivian-kanban-test .
docker run --rm rivian-kanban-test
```

## Repository map

Read [architecture/overview.md](../architecture/overview.md) first. Short version:
`packages/core` (domain — start here), `packages/db` (Drizzle adapters), `packages/server`
(Fastify + MCP + Slack composition root), `packages/web` (React SPA), `e2e/` (Playwright).

## Working agreement

1. TDD: failing test first — see [testing.md](testing.md) for which layer the test belongs in.
2. Run `npm run check` before pushing; CI enforces the same gates, so this is just faster
   feedback.
3. Atomic commits, Conventional Commits format; update docs in the same commit that changes
   behavior.
4. New architectural dependency or pattern → ADR in `docs/architecture/decisions/`.

## AI-assisted development (library docs, skills, MCP)

Most of the stack postdates common model training cutoffs, so recalling library APIs from memory
drifts. Prefer each library's own machine-readable docs / tools — fetch `llms(-full).txt` on
demand for exact APIs; `skills` (`npx skills add <repo> --skill <name>`) drop reusable agent skill
packages into the repo:

| Library                   | AI resource                                                                                                                                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Mantine 9** (UI)        | `mantine.dev/llms-full.txt`; skills `mantinedev/skills` (`mantine-form`, `mantine-combobox`, `mantine-custom-components`); `@mantine/mcp-server`. UI conventions in [frontend.md](../architecture/frontend.md#mantine-ui-library--conventions--ai-resources). |
| **TanStack Query 5**      | `tanstack.com/query/latest/llms.txt`                                                                                                                                                                                                                          |
| **Zod 4**                 | `zod.dev/llms.txt`                                                                                                                                                                                                                                            |
| **Drizzle ORM**           | `orm.drizzle.team/llms.txt`                                                                                                                                                                                                                                   |
| **OpenAI SDK** (`openai`) | `github.com/openai/openai-node` README + `helpers.md` (Structured Outputs / zod), `developers.openai.com/api/docs`. One OpenAI-compatible client selected by `SUMMARIZER_BASE_URL` (ADR-017).                                                                 |
| **Playwright** (e2e/QA)   | official MCP `@playwright/mcp` — browser automation over accessibility snapshots (`npx @playwright/mcp@latest`), handy for driving the app instead of the throwaway Playwright scripts                                                                        |

React (react.dev) and Fastify (fastify.dev) publish only standard HTML docs — no dedicated
`llms.txt`.

## Trying the MCP server locally

Run `npm run dev`, log in as the seeded admin, and create a token in **Settings → Service
tokens** (pick `read` unless the agent needs writes). Connect any MCP client (Streamable HTTP)
to `http://localhost:3000/mcp` with that bearer token. The only CLI is the break-glass
admin recovery (`node dist/cli.js users create-admin`, see
[deployment.md](../architecture/deployment.md#bootstrap-first-production-deployment)) — dev
doesn't need it because the demo seed includes an admin, and a fresh production database
creates its first admin through the browser setup page.

## Trying Slack locally (optional)

Set `SLACK_ENABLED=true`, `SLACK_BOT_TOKEN` (xoxb-), `SLACK_APP_TOKEN` (xapp-) in `.env` from a
dev workspace app configured per [architecture/slack.md](../architecture/slack.md). Socket Mode
needs no public URL. CI never needs any of this — Slack behavior is contract-tested with
recorded payloads.
