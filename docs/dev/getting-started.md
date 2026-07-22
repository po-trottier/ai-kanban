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

First boot creates `data/app.sqlite`, runs migrations, and seeds the demo dataset (board,
lanes, demo users for each role, sample cards). Demo logins are printed to the console —
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
2. Run `npm run db:generate` and `npm run generate:pg`; drizzle diffs the schema against the last
   snapshot and writes the next migration (`0001_*.sql`, `0002_*.sql`, …) for each dialect.
3. Commit the new migration file(s) **in the same commit** as the schema change.

`npm run db:migrate` applies any unapplied migrations in order; a fresh dev DB (`rm -rf data` then
`npm run dev`) replays the whole chain. (Pre-v1 this single file was regenerated in place; that era
is over — the baseline is now fixed.)

## Docker quickstart

The production topology is one compose stack (see
[architecture/deployment.md](../architecture/deployment.md) — THE deployment spec):

```bash
cp .env.example .env                  # set PUBLIC_BASE_URL + TRUST_PROXY_HOPS for your proxy,
                                      # plus any Slack/summarizer secrets. Compose itself pins
                                      # NODE_ENV=production and the /data storage paths — dev
                                      # values in .env cannot leak into the container
docker compose up -d --build          # build + boot; migrations and the structural seed run at boot
curl http://localhost:3000/readyz     # {"status":"ok"} — the same probe the HEALTHCHECK uses
```

Then open the app in a browser: the first boot shows the **setup page**, which creates the
first admin account (see
[deployment.md#bootstrap](../architecture/deployment.md#bootstrap-first-production-deployment)).
The `docker compose exec app npm run cli -- users create-admin --email you@org.com` command
remains as break-glass recovery if every admin is ever locked out.

The SPA, REST API, MCP mount, and SSE all serve from port 3000; Prometheus metrics live on the
internal 9464 listener that compose deliberately does not publish. Backups (Litestream sidecar)
are opt-in via `docker compose --profile backup up -d` once `litestream.yml` has real S3
values. To run the integration suite inside the production image exactly like CI:

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
admin recovery (`npm run cli -- users create-admin`, see
[deployment.md](../architecture/deployment.md#bootstrap-first-production-deployment)) — dev
doesn't need it because the demo seed includes an admin, and a fresh production database
creates its first admin through the browser setup page.

## Trying Slack locally (optional)

Set `SLACK_ENABLED=true`, `SLACK_BOT_TOKEN` (xoxb-), `SLACK_APP_TOKEN` (xapp-) in `.env` from a
dev workspace app configured per [architecture/slack.md](../architecture/slack.md). Socket Mode
needs no public URL. CI never needs any of this — Slack behavior is contract-tested with
recorded payloads.
