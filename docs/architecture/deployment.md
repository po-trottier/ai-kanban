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
- **Client IP derivation** (per-IP rate limits depend on it): the proxy must set/overwrite
  `X-Forwarded-For` — never append client-supplied values — and the app sets Fastify
  `trustProxy` to the known hop count. Get this wrong and either the whole company shares one
  rate-limit bucket or attackers spoof their way out of it.
- The app serves two listeners: the public port (SPA + API + MCP + SSE + health) and an
  **internal metrics port** that Compose does not publish and the proxy never routes; the org
  Prometheus scrapes it over the internal network.
- Slack needs no inbound route (Socket Mode is outbound).

## Bootstrap (first production deployment)

1. Boot always runs migrations plus the idempotent **structural seed**: board, 7 lanes,
   default permissive policy, `system` user (see data-model.md#seeding) — **no locations**, so
   production starts with an empty tree and the optional locations step below begins blank. Demo
   data (including the sample location tree) requires `SEED_DEMO_DATA=true` and is **refused in
   production mode**.
2. Open the app in a browser: while the database has no non-system users, every page redirects
   to the **first-boot setup page**, which creates the first admin account (policy-checked
   password, signed in immediately) and then offers an **optional locations step** — the new
   admin can add buildings/floors/rooms right away (reusing the admin `/locations` endpoints)
   or skip straight to the board; locations remain manageable later in Settings. The flow
   hard-disables itself once any user exists — race-guarded and rate-limited; see
   [security.md#authentication](security.md#authentication).

The CLI remains as **break-glass recovery** when every admin is locked out (setup never
reopens — deactivated users still count as existing):
`docker compose exec app npm run cli -- users create-admin --email you@org.com`
— prints a one-time temp password (`must_change_password` set; first login forces a change).

## Image

Multi-stage Dockerfile: build stage compiles TS + Vite bundle and rebuilds native modules
(better-sqlite3, argon2) for linux; runtime stage is `node:24-slim`, non-root user, only
production deps and built artifacts. `HEALTHCHECK` hits `/readyz`.

Because native-module prebuilds differ between Windows dev and Linux prod, **CI builds this
image and runs the full integration suite inside it** — a Node bump cannot pass locally and
crash in prod.

## Configuration (env, Zod-validated at boot)

| Variable                                                                                                     | Purpose                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                                                                                   | `production` disables demo seeding and dev docs UI                                                                                                                |
| `PORT`, `METRICS_PORT`, `PUBLIC_BASE_URL`, `TRUST_PROXY_HOPS`                                                | serving                                                                                                                                                           |
| `METRICS_HOST`                                                                                               | metrics bind address: `127.0.0.1` by default; the image sets `0.0.0.0` so the org Prometheus can scrape over the internal network (the port is never published)   |
| `DATABASE_PATH`, `BLOB_DIR`                                                                                  | `/data/app.sqlite`, `/data/blobs`                                                                                                                                 |
| `SNAPSHOT_DIR`                                                                                               | nightly online-backup snapshots (`/data/snapshots`); the newest 7 are retained                                                                                    |
| `MIGRATIONS_DIR`, `SPA_DIR`                                                                                  | image-only path pins (`/app/dist/migrations`, `/app/web`) — the esbuild bundle is relocated from the source tree; leave unset in dev                              |
| `SEED_DEMO_DATA`                                                                                             | demo fixtures (dev only; refused in production)                                                                                                                   |
| `SEED_DEMO_PASSWORD`                                                                                         | fixed demo-user password for deterministic dev/e2e logins (unset = random one-time passwords printed at first boot; refused in production)                        |
| `SLACK_ENABLED`, `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_TEAM_ID`                                       | Slack adapter (all required when enabled)                                                                                                                         |
| `SUMMARIZER_ENABLED`, `SUMMARIZER_PROVIDER`, `SUMMARIZER_MODEL`, `SUMMARIZER_API_KEY`, `SUMMARIZER_BASE_URL` | AI summarization — provider-agnostic (anthropic \| openai \| google \| any OpenAI-compatible endpoint incl. build.nvidia.com); default anthropic/claude-haiku-4-5 |
| `LOG_LEVEL`                                                                                                  | pino                                                                                                                                                              |

(No session secret: session ids are raw 256-bit randomness stored hashed — there is nothing to
sign; see security.md.)

Secrets are injected from the org secret store; the process refuses to boot on invalid config.

`docker-compose.yml` re-pins `NODE_ENV=production` and the `/data` + `/app` path pins in its
`environment:` block (which overrides `env_file`), so a dev-oriented `.env` copied from
`.env.example` can never repoint the container off its volume or out of production mode. The
`.env` file carries operator configuration only: `PUBLIC_BASE_URL`, `TRUST_PROXY_HOPS`, and
the Slack/summarizer secrets.

## Database operations

- SQLite in WAL mode (`journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout` set,
  `foreign_keys=ON`) — set on every connection by the db package.
- Migrations (drizzle-kit) run automatically at boot before the server listens; they are
  forward-only and committed to the repo.
- **Never copy a live SQLite database file** — a naive file copy of a WAL database silently
  corrupts. Backups are:
  1. **Litestream** continuous WAL streaming to S3-compatible storage (RPO ~seconds) — the
     compose `backup` profile, opt-in until S3 credentials exist (`litestream.yml`), and
  2. nightly online-backup snapshots (self-contained files, safe to copy) under
     `SNAPSHOT_DIR`, dated `app-YYYY-MM-DD.sqlite`, newest 7 retained, and
  3. the blob directory synced in the same backup job.
- **Restore drill**: the scheduled `restore-drill` workflow boots the image, snapshots via the
  same online backup, restores the snapshot into a fresh container (boot runs migrations), and
  requires `/readyz` plus the seeded data to survive — backups that are never restored don't
  exist. The equivalent operator command for a Litestream restore is documented at the top of
  `docker-compose.yml`.

## Observability

- `GET /healthz` — process alive; `GET /readyz` — DB ping ok (Docker/Compose healthcheck).
- `GET /metrics` on the internal listener — Prometheus: HTTP latency histograms per route, SSE
  client gauge, MCP tool-call counters, croner job outcomes, SQLite WAL-size gauge (checkpoint
  starvation is the known failure mode to watch), and blob-directory-size / volume-free-space
  gauges (disk-fill is the other one).
- pino JSON logs to stdout with request ids; redaction on.

## Upgrade & rollback

Deploys are `docker compose pull && up -d` (brief downtime is acceptable — PO decision).
Because migrations are forward-only, rollback = restore snapshot + previous image tag.
Application releases are tagged; the image embeds the git SHA at `/version` and in logs.

Note for operators: single-node Docker never restarts an unhealthy-but-running container —
the `HEALTHCHECK` feeds `docker compose ps` and monitoring visibility only. A wedged process
that still answers nothing on `/readyz` needs an operator (`docker compose restart app`);
`restart: unless-stopped` only covers exits and crashes (acceptable per the brief-downtime
decision above).

## Postgres migration (when HA or multi-instance is needed)

One coordinated move, planned together: Drizzle schema rewrite (`sqlite-core` → `pg-core`) +
regenerated migrations, EventBus port → LISTEN/NOTIFY, scheduler port → external scheduler
(pg-boss), Litestream → pg_dump/WAL archiving, then replicas become possible. Repository ports,
conservative column types, and the dependency-cruiser rules exist to keep this mechanical.
