# Deployment

Single-node Docker Compose (PO decision). One app container, one optional Litestream sidecar,
one named volume.

## Topology

```
docker compose
├── app         # Node 24, Fastify: SPA + REST + MCP + SSE + Bolt (Socket Mode) + croner jobs
│   └── volume: /data  → app.sqlite (+WAL) and blobs/
└── litestream  # optional sidecar: streams WAL pages to S3-compatible storage
```

- The app container is the **only** writer to the database — never scale it beyond 1 replica
  while on SQLite.
- TLS terminates at the org reverse proxy in front; the proxy must disable response buffering
  for `/api/v1/stream` (SSE) — e.g. nginx `X-Accel-Buffering: no`.
- Slack needs no inbound route (Socket Mode is outbound).

## Image

Multi-stage Dockerfile: build stage compiles TS + Vite bundle and rebuilds native modules
(better-sqlite3, argon2) for linux; runtime stage is `node:24-slim`, non-root user, only
production deps and built artifacts. `HEALTHCHECK` hits `/readyz`.

Because native-module prebuilds differ between Windows dev and Linux prod, **CI builds this
image and runs the full integration suite inside it** — a Node bump cannot pass locally and
crash in prod.

## Configuration (env, Zod-validated at boot)

| Variable | Purpose |
| --- | --- |
| `PORT`, `PUBLIC_BASE_URL` | serving |
| `DATABASE_PATH`, `BLOB_DIR` | `/data/app.sqlite`, `/data/blobs` |
| `SESSION_SECRET` | cookie signing |
| `SLACK_ENABLED`, `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN` | Slack adapter (tokens required only when enabled) |
| `SUMMARIZER_ENABLED`, `ANTHROPIC_API_KEY` | AI summarization |
| `LOG_LEVEL` | pino |

Secrets are injected from the org secret store; the process refuses to boot on invalid config.

## Database operations

- SQLite in WAL mode (`journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout` set,
  `foreign_keys=ON`) — set on every connection by the db package.
- Migrations (drizzle-kit) run automatically at boot before the server listens; they are
  forward-only and committed to the repo.
- **Never copy a live SQLite database file** — a naive file copy of a WAL database silently
  corrupts. Backups are:
  1. **Litestream** continuous WAL streaming to S3-compatible storage (RPO ~seconds), and
  2. nightly `VACUUM INTO` snapshots (self-contained files, safe to copy), and
  3. the blob directory synced in the same backup job.
- **Restore drill**: a scheduled CI job restores the latest snapshot, runs migrations against
  it, and boots the app read-only — backups that are never restored don't exist.

## Observability

- `GET /healthz` — process alive; `GET /readyz` — DB ping ok (Docker/Compose healthcheck).
- `GET /metrics` — Prometheus: HTTP latency histograms per route, SSE client gauge, MCP
  tool-call counters, croner job outcomes, and SQLite WAL-size gauge (checkpoint starvation is
  the known failure mode to watch).
- pino JSON logs to stdout with request ids; redaction on.

## Upgrade & rollback

Deploys are `docker compose pull && up -d` (brief downtime is acceptable — PO decision).
Because migrations are forward-only, rollback = restore snapshot + previous image tag.
Application releases are tagged; the image embeds the git SHA at `/version` and in logs.

## Postgres migration (when HA or multi-instance is needed)

One coordinated move, planned together: Drizzle schema rewrite (`sqlite-core` → `pg-core`) +
regenerated migrations, EventBus port → LISTEN/NOTIFY, scheduler port → external scheduler
(pg-boss), Litestream → pg_dump/WAL archiving, then replicas become possible. Repository ports,
conservative column types, and the dependency-cruiser rules exist to keep this mechanical.
