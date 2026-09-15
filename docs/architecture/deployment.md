# Deployment

Single-node Docker Compose (PO decision). One postgres container, one app container, two named
volumes (`pgdata` for postgres, `data` for app). Litestream is available as a standalone config
file (`litestream.yml`) for optional S3-compatible WAL streaming, not as a docker-compose service.

## Requirements

- A Linux AMD64 host with Docker Engine and a current Docker Compose v2 plugin.
- Access to the [GHCR package](https://github.com/po-trottier/ai-kanban/pkgs/container/ai-kanban).
- An HTTPS reverse proxy for production access, plus persistent disk space for the two volumes.

The commands below use a Bash shell on the Docker host. No Node.js install or app build is
needed there. Only `docker-compose.yml` and `.env` are needed at runtime; cloning the repo
is the simplest way to obtain the Compose file, example configuration, and these instructions.

## Topology

```
docker compose
├── postgres    # PostgreSQL 17 — the production database (ADR-020); named volume pgdata
└── app         # Node 24, Fastify: SPA + REST + MCP + SSE + Bolt (Socket Mode) + croner jobs
    └── volume: /data  → blobs/ (DATABASE_URL points at the postgres service)
```

- **docker-compose runs on PostgreSQL** ([ADR-020](decisions/ADR-020-postgresql-support.md)): the
  app reads `DATABASE_URL` and the SQLite-only paths below (single-writer rule, WAL/VACUUM
  snapshots, Litestream) do not apply. The **dev server** (`npm run dev`) still uses SQLite.
- SQLite single-node (below) remains a supported lightweight alternative: unset `DATABASE_URL`,
  set `DATABASE_PATH`, and the app container becomes the **only** writer — never scale it beyond
  1 replica while on SQLite.
- TLS terminates at the org reverse proxy in front; the proxy must disable response buffering
  for `/api/v1/stream` (SSE) — e.g. nginx `X-Accel-Buffering: no`.
- **Client IP derivation** (per-IP rate limits depend on it): the proxy must set/overwrite
  `X-Forwarded-For` — never append client-supplied values — and the app sets Fastify
  `TRUST_PROXY` to the actual proxy IPs/CIDRs. Get this wrong and either the whole company shares one
  rate-limit bucket or attackers spoof their way out of it.
- The app serves two listeners: the public port (SPA + API + MCP + SSE + health) and an
  **internal metrics port** that Compose does not publish and the proxy never routes; the org
  Prometheus scrapes it over the internal network.
- Slack needs no inbound route (Socket Mode is outbound).

## Bootstrap (first production deployment)

### Cloudflare Tunnel on a separate VM

Set `PUBLIC_BASE_URL` to the public HTTPS origin (for example, `https://rivian.p-o.me`).
Set `TRUST_PROXY` to the private IP of the VM running `cloudflared`, with `/32` for one IPv4
address (for example, `192.168.1.50/32`). This assumes routing preserves that VM's source IP;
if there is NAT or another reverse proxy, use the actual proxy source address seen by the app.
Do not use `loopback`, the Proxmox host's IP, or Cloudflare's public IP ranges for this topology.

In the tunnel's published application route, point the hostname at
`http://<app-VM-private-IP>:3000`. Add a Cloudflare Access policy for the hostname and restrict
the app VM's port 3000 to the connector VM, including traffic forwarded through Docker.
This prevents direct access around the Access policy. Cloudflare Access is an outer gate;
the app's own login remains required. Cloudflare supplies the visitor's forwarded IP headers
([header reference](https://developers.cloudflare.com/fundamentals/reference/http-headers/)).

Open the public **HTTPS** hostname in the browser. Port 3000 serves plain HTTP to the
connector; `PUBLIC_BASE_URL` does not enable TLS there. Opening the production UI directly at
`http://<app-VM-IP>:3000` can fail to load CSS/JavaScript because the security policy upgrades
asset requests to HTTPS (`ERR_SSL_PROTOCOL_ERROR`). Keep the tunnel's origin service on HTTP
and use the HTTPS hostname for the UI. The `/readyz` HTTP endpoint remains useful for origin checks.

### Start the stack

For Arcane, paste `docker-compose.yml` into a new project and enter the settings below in
its **Environment Configuration (.env)** editor. Keep the existing `env_file` block;
Arcane saves the project `.env` beside the Compose file. `required: false` permits a missing
file but does not supply defaults for required settings such as `POSTGRES_PASSWORD`.
Use the project editor for these values; global interpolation variables alone are not
automatically injected into the app container
([Arcane projects](https://getarcane.app/docs/features/projects#create-a-project)).

```bash
git clone https://github.com/po-trottier/ai-kanban.git rivian-kanban
cd rivian-kanban
cp .env.example .env
```

Edit `.env`:

| Setting                               | Deployment value                                                                                                                              |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD`                   | A long random alphanumeric password, replacing `change-me`. Compose embeds it in a connection URL, so avoid URL-reserved characters.          |
| `PUBLIC_BASE_URL`                     | The external HTTPS origin, such as `https://kanban.example.com`. Use `http://localhost:3000` only for a local trial.                          |
| `TRUST_PROXY`                         | Comma-separated trusted proxy IPs/CIDRs as seen by the app. Leave empty for direct access. Trust only the proxy addresses, never all clients. |
| `IMAGE_TAG`                           | `latest` for the current stable release, a release version such as `1.0.1`, or `sha-<full git SHA>` for a specific commit.                    |
| `SEED_DEMO_DATA`                      | Keep `false`. Leave `SEED_DEMO_PASSWORD` commented out or remove it from an existing development `.env`.                                      |
| `SLACK_ENABLED`, `SUMMARIZER_ENABLED` | Keep `false` unless you also configure their credentials.                                                                                     |

For a proxy sharing the app's network namespace, `TRUST_PROXY=127.0.0.1,::1` trusts loopback.
A proxy on the Docker host or in another container usually connects from a different address;
use its actual IP/CIDR and restrict direct access to port 3000 to the proxy. Existing deployments
must replace `TRUST_PROXY_HOPS` with these addresses; numeric hop counts are no longer supported.

Keep the default `PORT=3000` unless you also update the Compose port mapping. Compose sets
`NODE_ENV=production` and the database/storage paths automatically. Keep `.env` private and
out of Git. The published image supports anonymous pulls:

```bash
docker compose config --quiet
docker compose pull
docker compose up -d --wait
docker compose ps
curl --fail http://localhost:3000/readyz
curl --fail http://localhost:3000/version
```

`--wait` waits for both services to become healthy. `/readyz` must return HTTP 200;
**Settings → Preferences → About** shows the running version, build revision, and build time
for every signed-in user. Use **Refresh version** after redeploying in Arcane to verify the update.
This reads `/version` without caching; checking for new images in Arcane does not itself recreate
the running container unless automatic updates are enabled.

`/version` identifies the running build and sends `Cache-Control: no-store`. If startup fails, inspect
`docker compose logs --tail=100 app postgres`.

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
`docker compose exec app node dist/cli.js users create-admin --email you@org.com`
— prints a one-time temp password (`must_change_password` set; first login forces a change).

## Image

Multi-stage Dockerfile: build stage compiles TS + Vite bundle and rebuilds native modules
(better-sqlite3, argon2) for linux; runtime stage is `node:24-trixie-slim`, non-root user, only
production deps and built artifacts. `HEALTHCHECK` hits `/readyz`.

The runtime installs available Debian security updates and excludes npm, Corepack, and Yarn.
Use `node dist/cli.js` for recovery commands. CI tests that the CLI writes to the same
PostgreSQL database as the app, scans the image before publishing it, and retains a full
`image-vulnerabilities` report. Fixable HIGH/CRITICAL findings block publication; unfixed
vendor findings remain visible in that report (see [security](security.md#dependency--supply-chain)).

Because native-module prebuilds differ between Windows dev and Linux prod, **CI builds this
image and runs the full integration suite inside it** — a Node bump cannot pass locally and
crash in prod.

## Published image

The deployment image is `ghcr.io/po-trottier/ai-kanban:latest` (Linux AMD64).
The `CI` workflow publishes the exact runtime image that passed the Docker integration
suite and smoke boot, after quality, coverage, browser, and security checks pass. Publishing
a GitHub release triggers a build of that release's exact commit. Pushes and manual workflow
runs on `main` also publish development images; pull requests never publish.
The image includes the repository source, version, and git revision labels.

Tags:

- `1.0.1` and `v1.0.1`: the same image for GitHub release `v1.0.1`.
- `latest`: the release marked latest by GitHub, updated only after its image passes CI.
  Prereleases and older releases never replace it.
- `main`: the most recently published passing `main` build, for testing before a release.
- `sha-<full git SHA>`: a specific commit build. Set `IMAGE_TAG` in `.env` to pin it.

This package supports anonymous pulls, so `docker compose pull` needs no GitHub credentials.
If you deploy a private fork or the package visibility changes, log in with a GitHub personal
access token (classic) with `read:packages` and access to that package:

```bash
docker login ghcr.io -u YOUR_GITHUB_USERNAME
```

Enter the token at the password prompt; do not use your GitHub account password. For unattended
deployments, pipe the token from your secret store to `docker login --password-stdin`.
Package owners can
enable anonymous pulls by changing the package visibility to public in GitHub package settings.
See [GitHub's container registry documentation](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).

## Install as an app (PWA)

Facilities Kanban can be installed from Chrome on the deployed HTTPS origin, for example
`https://rivian.p-o.me`. Sign in through Cloudflare Access first if it is enabled, then use the
address-bar install icon or **Chrome menu → Cast, save, and share → Install page as app**.
On Android, use Chrome's **Install app** menu option. Chrome controls when the install promotion
appears; the menu remains the manual installation route. See [Chrome's installation help](https://support.google.com/chrome/answer/9658361).

The installed app opens the board in a standalone window. The same login, Cloudflare Access
policies, and permissions apply. It requires a network connection; work orders and pending edits
are not saved for offline use. After an image update, reload or reopen the app and check
**Settings → Preferences → About**. No service worker caches old application bundles.

The static build serves `/manifest.webmanifest` and `/icons/*.png`. Keep those paths reachable
under the same hostname; the manifest link sends same-origin credentials for authenticated
Cloudflare routes. Direct HTTP access on a LAN IP is not an installable secure origin; use the
public HTTPS address (localhost is a development exception). App identity stays `/` across
releases, so version changes do not create a second installed app.

## Release workflow

GitHub releases are the source of truth for versioned images, starting with `v1.0.1`.
The workflow rejects a release unless its tag is `v` followed by the root `package.json`
version and every workspace version and internal dependency reference agrees. Before pushing,
it also boots the image and checks that `/version` contains that version and the release's
exact git SHA. Both `1.0.1` and `v1.0.1` tags therefore identify version `1.0.1` in the app.

To release a new version:

1. Update the changelog and all workspace versions/internal references; regenerate
   `package-lock.json` with `npm install --package-lock-only`.
2. Run `npm run check`, commit, and push the changes. Wait for CI to pass.
3. Tag that checked commit `v<version>` and push the tag.
4. Publish a GitHub release for the tag, through GitHub's Releases page or
   `gh release create <tag> --verify-tag --notes-file release-notes.md`. Mark release
   candidates as prereleases; they get versioned tags but do not update `latest`.
5. Wait for the release's `CI` run to finish successfully, then deploy that image version.

Pushing a git tag alone does not trigger publication. A failed gate leaves the existing
release image untouched; inspect the failed Actions job and rerun the release workflow after
resolving the failure. Automation does not backfill older releases that predate this workflow
or retag newer application code as an old release.

## Configuration (env, Zod-validated at boot)

| Variable                                                                              | Purpose                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                                                            | `production` disables demo seeding and dev docs UI                                                                                                                                                                                |
| `PORT`, `METRICS_PORT`, `PUBLIC_BASE_URL`, `TRUST_PROXY`                              | serving                                                                                                                                                                                                                           |
| `METRICS_HOST`                                                                        | metrics bind address: `127.0.0.1` by default; the image sets `0.0.0.0` so the org Prometheus can scrape over the internal network (the port is never published)                                                                   |
| `DATABASE_PATH`, `BLOB_DIR`                                                           | `/data/app.sqlite`, `/data/blobs`                                                                                                                                                                                                 |
| `SNAPSHOT_DIR`                                                                        | nightly online-backup snapshots (`/data/snapshots`); the newest 7 are retained                                                                                                                                                    |
| `MIGRATIONS_DIR`, `SPA_DIR`                                                           | image-only path pins (`/app/dist/migrations`, `/app/web`) — the esbuild bundle is relocated from the source tree; leave unset in dev                                                                                              |
| `SEED_DEMO_DATA`                                                                      | demo fixtures (dev only; refused in production)                                                                                                                                                                                   |
| `SEED_DEMO_PASSWORD`                                                                  | fixed demo-user password for deterministic dev/e2e logins (unset = random one-time passwords printed at first boot; refused in production)                                                                                        |
| `SLACK_ENABLED`, `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_TEAM_ID`                | Slack adapter (all required when enabled)                                                                                                                                                                                         |
| `SUMMARIZER_ENABLED`, `SUMMARIZER_MODEL`, `SUMMARIZER_API_KEY`, `SUMMARIZER_BASE_URL` | AI summarization via the `openai` SDK over any OpenAI-compatible endpoint (OpenAI, NVIDIA NIM, LiteLLM proxy, vLLM, …); provider = `SUMMARIZER_BASE_URL` (default `https://api.openai.com/v1`); model + key required when enabled |
| `LOG_LEVEL`                                                                           | pino                                                                                                                                                                                                                              |

(No session secret: session ids are raw 256-bit randomness stored hashed — there is nothing to
sign; see security.md.)

Secrets are injected from the org secret store; the process refuses to boot on invalid config.

`docker-compose.yml` re-pins `NODE_ENV=production` and the `/data` + `/app` path pins in its
`environment:` block (which overrides `env_file`), so a dev-oriented `.env` copied from
`.env.example` can never repoint the container off its volume or out of production mode. The
`.env` file carries operator configuration, including `IMAGE_TAG`, `POSTGRES_PASSWORD`,
`PUBLIC_BASE_URL`, `TRUST_PROXY`, and the Slack/summarizer secrets.

## Database operations

### Default PostgreSQL deployment

Migrations run automatically before the app starts accepting requests. The `pgdata` volume
holds PostgreSQL records; the `data` volume holds uploaded files under `/data/blobs`.
Both survive container replacement and `docker compose down`. Do not use
`docker compose down --volumes` unless you intend to delete the stored data.

Back up the database with PostgreSQL tooling, for example:

```bash
docker compose exec -T postgres pg_dump -U rivian rivian > backup.sql
```

Also back up the app's `data` volume through your Docker host's backup tooling. Stop the app
with `docker compose stop app` while taking a coordinated database-and-uploads backup,
then restart it with `docker compose start app`. Store backups off the Docker host and test
restores into a separate stack. Changing `POSTGRES_PASSWORD` in `.env` does not rotate an
existing PostgreSQL user's password; update the database user and configuration together.

### Optional SQLite deployment

- SQLite in WAL mode (`journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout` set,
  `foreign_keys=ON`) — set on every connection by the db package.
- Migrations (drizzle-kit) run automatically at boot before the server listens; they are
  forward-only and committed to the repo.
- **Never copy a live SQLite database file** — a naive file copy of a WAL database silently
  corrupts. Backups are:
  1. **Litestream** continuous WAL streaming to S3-compatible storage (RPO ~seconds) — a
     standalone config file (`litestream.yml`), run separately (not a docker-compose profile)
     once S3 credentials exist, and
  2. nightly online-backup snapshots (self-contained files, safe to copy) under
     `SNAPSHOT_DIR`, dated `app-YYYY-MM-DD.sqlite`, newest 7 retained, and
  3. the blob directory synced in the same backup job.
- **Restore drill**: the scheduled `restore-drill` workflow boots the image, snapshots via the
  same online backup, restores the snapshot into a fresh container (boot runs migrations), and
  requires `/readyz` plus the seeded data to survive — backups that are never restored don't
  exist. This drill covers the SQLite alternative; production PostgreSQL backups require
  their own restore checks.

## Observability

- `GET /healthz` — process alive; `GET /readyz` — DB ping ok (Docker/Compose healthcheck).
- `GET /metrics` on the internal listener — Prometheus: HTTP latency histograms per route, SSE
  client gauge, MCP tool-call counters, croner job outcomes, SQLite WAL-size gauge (checkpoint
  starvation is the known failure mode to watch), and blob-directory-size / volume-free-space
  gauges (disk-fill is the other one).
- pino JSON logs to stdout with request ids; redaction on.

## Upgrade & rollback

1. Record the current `/version` response and back up the database and uploads.
2. Set `IMAGE_TAG=1.0.1` in `.env` to select a release (or choose the desired newer version).
   Use `latest` to follow the latest stable release, or `sha-<full git SHA>` to pin a commit.
3. Run `docker compose pull` followed by `docker compose up -d --wait`.
4. Verify `/readyz`, `/version`, and the board in the browser.

Brief downtime is acceptable. Because migrations are forward-only, rollback after a schema
change means stopping the app, restoring the matching database and uploads backup, selecting
the previous `IMAGE_TAG`, and starting again. Merely changing the image tag does not undo a
database migration.

Note for operators: single-node Docker never restarts an unhealthy-but-running container —
the `HEALTHCHECK` feeds `docker compose ps` and monitoring visibility only. A wedged process
that still answers nothing on `/readyz` needs an operator (`docker compose restart app`);
`restart: unless-stopped` only covers exits and crashes (acceptable per the brief-downtime
decision above).

## PostgreSQL

The data layer runs on **PostgreSQL** for production (set `DATABASE_URL`;
[ADR-020](decisions/ADR-020-postgresql-support.md)) — the `sqlite-core` → `pg-core` rewrite behind
the unchanged repository ports: a `pgTable` schema, async repositories, an async unit of work, and
a single `0000_init` pg migration. `docker-compose.yml` launches `postgres:17-alpine` and points the app at
it; back up with standard pg tooling (`pg_dump` / WAL archiving) instead of Litestream. Remaining
HA follow-ups (still open): the in-process EventBus → `LISTEN/NOTIFY` and the croner scheduler →
an external scheduler before scaling the app past one replica.
