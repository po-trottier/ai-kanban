# Agent instructions — rivian-kanban (canonical)

The single source of truth for how any AI agent works in this repo, shared by every harness — Claude
Code imports it from `CLAUDE.md` (`@import`), Codex reads it via `AGENTS.md` + `.codex/`. **Edit THIS
file**; the harness files only point here and add harness-specific setup.

## The repo in one line

Facilities-management Kanban — a TypeScript monorepo: `packages/core` (Zod domain + services,
hexagonal), `db` (Drizzle + SQLite behind ports), `server` (Fastify + MCP mount + Slack), `web`
(React 19 + Mantine 9 SPA), `e2e` (Playwright). **`docs/` is the human-first spec — read it before
changing behavior**, starting with `docs/architecture/overview.md` and the ADRs.

## How to work here

- **Docs, not memories, for project knowledge.** Anything worth remembering about THIS project
  (decisions, conventions, gotchas, "why it's like this") goes into `docs/` as a checked-in, shared,
  versioned document — NOT into a personal or per-agent memory store. Personal memory is only for
  cross-project user preferences. If you learn something project-specific, write it to `docs/` in the
  same PR.
- **Understand before editing.** Trace the real flow end to end, reuse what already exists, then take
  the smallest correct change. Never skip comprehension to ship a small diff — a confident wrong fix
  is worse. Fix the root cause, not the symptom (grep every caller of what you touch).
- **TDD + the gate.** A feature lands with its tests. Run `npm run check` (format, lint, typecheck,
  depcruise, knip, tests) before pushing; CI enforces the same gates.
- **Commits.** Atomic, Conventional Commits (`type(scope): subject`, lowercase subject), with docs
  updated in the SAME commit as the behavior they describe. End every commit message with
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Never skip hooks or bypass signing.
- **Frozen v1 baseline, forward-only, no legacy.** `0000_init` is the immutable v1 schema baseline;
  schema changes now **append** the next migration (`0001_*`, …) — never regenerate the baseline
  (see `docs/dev/getting-started.md` → "Changing the schema"). No back-compat branches.
- **Enforced conventions** (`docs/dev/standards.md`): `core` imports no framework/IO; only `db` touches
  drizzle/better-sqlite3; every REST route declares Zod request+response schemas; no dead code or
  unused deps (knip); one shape defined once in `core` drives REST + MCP + forms (single-schema rule).
- **UI**: Mantine 9 + lucide-react. NEVER hand-roll `<svg>`/`<path>` icons — use lucide (inside
  `ActionIcon`/`ThemeIcon`). Design values live only in `src/theme.ts`; overrides go through the
  Styles API, never inline pixel literals. See `docs/architecture/frontend.md`.

## Use each library's own AI resources — don't guess APIs

Mantine 9, TanStack Query 5, Zod 4, Drizzle, and the `openai` SDK all postdate common model training
cutoffs, so recalling their APIs from memory drifts. Fetch their `llms(-full).txt` / docs, or use
their skills / MCP servers, for exact APIs. The per-library table is in
`docs/dev/getting-started.md` → "AI-assisted development".

## Tooling wired up in this repo

- **MCP servers** — `@playwright/mcp` (drive a real browser over accessibility snapshots — prefer it
  over ad-hoc Playwright scripts) and `@mantine/mcp-server` (Mantine docs/props). Claude reads
  `.mcp.json` (pre-approved in `.claude/settings.json`); Codex reads `.codex/config.toml` (trust the
  project on first run). The app's OWN MCP is `POST /mcp` with a bearer `rkb_…` token — per-user, so
  it isn't committed; add it from `docs/architecture/mcp.md` when needed.
- **Skills** — canonical copies live in `.agents/skills/` (see its README); added with the
  `vercel-labs/skills` CLI (`npx skills add`), which symlinks each harness to the canonical copy.
