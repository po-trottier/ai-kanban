# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.8] - 2026-09-15

### Fixed

- Load styles in component tests and allow bounded async rendering time under coverage, preventing
  false scroll warnings and premature settings-test failures on CI runners.

## [1.0.7] - 2026-09-15

### Changed

- Show only the logo beside the board selector in the header, freeing space at every screen width.
- Rename the app and installed PWA to Rivian Facilities Tickets System. Browser tabs show
  Rivian {board name} Tickets System for the selected board.

### Added

- Choose a personal default board from Settings → Boards, including for non-admins. Admins can
  assign group, role, and global defaults from the board editor; startup respects User → Group →
  Role → Global, skipping invalid or inaccessible choices before falling back to the first
  accessible board. Users with no accessible boards see instructions for requesting access.
- Switch between boards from the responsive header selector. Admins can manage boards and groups
  in Settings and grant board access to roles, selected people, or groups.
- Enforce board visibility across searches, direct links, downloads, notifications, live updates,
  and MCP tools while preserving existing work orders and globally unique ticket numbers.
- Manage waiting reasons in Settings: keep the current defaults, add or rename choices, and remove
  them from new selections while preserving existing cards and history. MCP clients can discover
  configured choices with `list_waiting_reasons`.

### Fixed

- Keep dropdowns stable inside scrolling dialogs on phones.
- Keep settings tabs on one scrollable row and contain wide tables within their panels on phones.
  Permission labels stay readable while role columns scroll; nested location actions remain reachable.
- Select the board directly in Columns settings and edit its columns without leaving the tab.
- Keep settings Add buttons fully readable by wrapping their descriptions into the remaining space.
- Order settings by purpose: preferences first, then boards and workflow, users beside groups,
  and service tokens last.
- Match the board selector's height to the standard header buttons on desktop and phones.
- Return all saved board settings through the API, including working hours and waiting reasons.
- Restore hover help on the assignee and reporter filters, and show full card titles in tooltips.
- Keep the mobile header on one compact row with the logo and icon actions, and display work-order
  details across the full board width instead of squeezing them beside the columns.
- Move keyboard focus into opened work-order details without raising the phone keyboard.
- Resolve moves against actual lane positions so cards hidden by filters or archival cannot cause
  a position conflict when dropping or using the move menu.

## [1.0.6] - 2026-09-14

### Fixed

- Keep sign-in, setup, and password-change forms within narrow phone and installed-app windows.

## [1.0.5] - 2026-09-14

### Added

- Install Facilities Kanban from Chrome as a standalone app, with app icons and a stable identity
  across deployments. The app requires an internet connection.

## [1.0.4] - 2026-09-14

### Added

- Show the running app version, build revision, and build time under Settings → Preferences → About,
  with a refresh button to verify deployments.

### Changed

- Show a draggable scrollbar whenever board filters overflow, replacing the navigation arrows.

## [1.0.3] - 2026-09-14

### Fixed

- Keep board filters on one horizontally scrollable row at desktop and mobile widths, with
  navigation arrows and touch scrolling when the controls do not fit.

## [1.0.2] - 2026-09-14

### Security

- Reject login/password-change attempts whose verified credentials became stale during a
  concurrent account reset, preventing old passwords from surviving recovery.
- Revoke OAuth access tokens, refresh tokens, and pending authorization codes on password
  changes, administrator resets, role changes, deactivation, and break-glass recovery.
  Reject OAuth consent, token issuance, and MCP access while a password change is required.
- Revoke a client's access tokens when its refresh grant is revoked, while keeping other
  clients connected and making repeated or expired revocations harmless.
- Require loopback OAuth callbacks to preserve every component except the ephemeral port.
- Update the runtime to Debian Trixie with available security updates and remove unused
  npm/Yarn tooling. CI now scans the runtime image, blocks fixable high/critical findings,
  and retains the complete report including findings without vendor fixes.

### Fixed

- Make the administrator recovery CLI honor `DATABASE_URL`, so PostgreSQL deployments
  recover the live account instead of creating an administrator in an unused SQLite file.
- Submit the OAuth consent form using the field names accepted by the authorization endpoint.
- Document Arcane environment configuration and Cloudflare Tunnel through a separate VM.
- Clarify that the published GHCR image supports anonymous pulls; registry login is only
  needed for private packages.

## [1.0.1] - 2026-09-14

### Added

- Publish tested production images to GitHub Container Registry on GitHub releases, with
  matching version tags and `latest` for the current stable release. Main builds publish
  separately as `main`; all builds also get commit-specific tags. Docker Compose pulls the published image, so
  deployment no longer requires building the app on the server.
- Verify release tags against every workspace version and check the running image's version
  and commit before publication. The README and deployment guide include complete setup steps.

### Fixed

- Leave the optional demo password unset in `.env.example` so copying it for production
  does not trigger the server's demo-credential rejection.
- Close live board streams before shutting down the HTTP server so container upgrades
  can finish gracefully with browsers connected.

### Security

- Update Fastify/static serving, Tiptap, React Router, Vitest, PostCSS, and affected transitive
  dependencies to patched versions so the deployment image passes the current security gates.
- Replace `TRUST_PROXY_HOPS` with `TRUST_PROXY` (trusted proxy IPs/CIDRs). Configure the actual
  proxy addresses on existing deployments; hop counts alone cannot prevent clients from
  spoofing forwarded headers when they can reach the app directly.

## [1.0.0] - 2026-07-21

Initial release.

### Added

#### Board & work orders

- Seven-column facilities workflow board — Intake → Waiting for Approval → Ready → In Progress →
  Waiting on Parts / Vendor → Review → Done — where within-column order is the "what's next" queue
- Drag-and-drop cards between and within columns, with keyboard/touch "Move to…" and a detail-panel
  State dropdown as accessible alternatives
- Admin-configurable columns: add, rename, reorder, delete, and set per-column WIP limits
- Optional workflow enforcement that requires cards to follow the configured column flow, with
  per-transition role requirements
- Waiting-lane discipline: moving a card to Waiting on Parts / Vendor prompts for a reason (parts,
  vendor, access, info, funding) and an expected resume date, editable in place from the Waiting
  banner
- Block a card with a reason to flag it for help without moving it
- Cancel a card with a resolution (cancelled, declined, duplicate); cancelled cards sort to the end
  of Done with a badge
- Reopen completed or cancelled cards back to their exact prior state
- Archive cards manually from the ⋯ menu, with automatic archival 90 days after reaching Done
- Undo toasts (Gmail-style) for cancel, archive, and block, alongside a global undo/redo stack for
  board moves and card actions

#### Cards, estimates & scheduling

- Create work orders with title, rich-text description, priority, estimate, reporter, assignee,
  tags, and optional location
- Priority levels P0 (drop everything), P1, and P2, independent of column order
- WYSIWYG rich-text description editor (bold, italic, strikethrough, inline code, headings, lists,
  blockquote, links) round-tripped as Markdown
- Time estimates entered as a duration or a target date, with a burn-down bar tracked in business
  time and an "Overdue" chip once elapsed business time exceeds the estimate
- Admin-configurable business hours (Settings → Hours) driving the burn-down clock and overdue
  dating (default Mon–Fri 09:00–17:00)
- Per-user timezone (auto-detected at signup) and light/dark/system theme preference
- Collapsible, resizable right-side detail panel (full-screen on tablets) with all fields editable
  in place, plus attachments, comments, and history tabs
- Typed card-to-card relations (blocks, duplicates, relates to) with inverses, added by searching
  title, work-order number, or a pasted URL

#### Comments, mentions & watching

- Threaded comment discussions with replies; edit your own comments, and deleted comments leave a
  placeholder so replies keep context
- @-mention teammates with inline autocomplete; a mention notifies and deep-links to the exact
  comment
- Watch cards with a bell toggle, plus auto-watch when you report, are assigned, comment, or are
  mentioned — unwatch to opt out

#### Notifications

- In-app notification inbox, newest-first, with an unread badge and unread/all filter
- Per-notification status dot — a filled indigo disc while unread, a hollow grey circle once read —
  that toggles read/unread and deep-links to the relevant card or comment
- Slack DMs on assignment, on card completion (with a reopen link), and when a waiting card's resume
  date passes (to the assignee and active admins)

#### Search, filters & presets

- Free-text search over card title and description
- Filters for priority, assignee, reporter, tags, location, overdue status, and archived status
- Subtree-inclusive location filter (pick a building, get its floors and rooms)
- Saved filter presets — private or shared with the team — plus built-in All, Mine, and Overdue
  presets
- Shareable filtered-board URLs and one-click filter reset

#### Locations

- Location tree of buildings, floors, and rooms managed in Settings → Locations, optionally assigned
  to any work order, with an optional first-boot setup step

#### Attachments

- Attach images (PNG, JPEG, WebP, HEIC) and PDFs to cards — up to 25 MB per file and 10 active files
  per card — droppable from a phone or tablet camera roll

#### Audit trail & history

- Immutable, append-only history on every card recording status moves, field edits, comments,
  attachments, and blocks — with field-level before/after diffs
- Actor attribution on every event across users, the Slack bot, MCP/AI agents, and system jobs,
  including "agent on behalf of user" for OAuth-minted tokens

#### Realtime & offline

- Live board updates over Server-Sent Events with automatic client reconnect and refetch
- Optimistic UI for moves and edits, with stale changes safely rejected and the board refreshed on
  conflict

#### Authentication & accounts

- First-boot setup page that creates the initial administrator account before anyone signs in
- Email + password sign-in with server-side sessions (7-day sliding idle expiry, 30-day absolute
  cap) revoked immediately on logout, password change, role change, or deactivation
- Admin-issued one-time temporary passwords with a forced password change on first sign-in, and
  user self-service password change

#### Permissions, roles & policy

- Permissive-by-default, fully configurable RBAC where roles are data with per-permission grant
  maps, editable in Settings
- Fine-grained permissions gating both the settings surface (manage users, roles, locations,
  columns, policy, tokens) and card actions (create, update, move, cancel, reopen, archive, block,
  comment, attach, and more)
- Guardrails preventing admin lockout (the last role that can manage roles cannot lose it) and
  preventing removal of a role still assigned to a user or token
- Append-only, versioned permission-policy history with authorship and timestamps

#### MCP (AI agents)

- Built-in MCP server at `POST /mcp` (Streamable HTTP) exposing the board to AI agents, with
  self-service setup from `/llms.txt`
- Read tools (board snapshot, list/get cards, history, stale and blocked cards, activity, lanes,
  locations, tags, whoami) and write tools (create, update, move, comment, cancel, reopen, archive,
  block, unblock)
- Per-user `rkb_` service tokens for headless agents and an OAuth flow for interactive agents, both
  with read vs. read_write scopes; agents act with their user's role, never broader
- Agent actions route through the same core services, permission checks, and audit trail as every
  other actor

#### Slack integration

- Create facilities tickets from a Slack thread via the "Create facilities ticket" message shortcut
  or by @-mentioning the bot
- Optional AI-drafted ticket fields (title, description, suggested priority, tags) summarized from
  the thread, with human review before creation
- Slack accounts matched to board users by email; runs over Socket Mode with no inbound HTTP
  endpoint
- Provider-agnostic, OpenAI-compatible summarizer (OpenAI, NVIDIA NIM, LiteLLM, vLLM, …) selected by
  configuration, gated by a feature flag with per-user rate limits and a global budget

#### Platform & deployment

- SQLite (default, for development and single-node) and PostgreSQL (production, via `DATABASE_URL`)
  as first-class storage backends behind the same repository ports
- Single Node process serving the REST API, static SPA, MCP, SSE stream, Slack client, and scheduled
  jobs
- Every REST route declares strict Zod request and response schemas; one schema in `core` drives
  REST, MCP, and the web forms
- Environment-variable configuration validated at boot — the process refuses to start on missing or
  malformed config
- Health and readiness endpoints (`/healthz`, `/readyz`) and a Prometheus `/metrics` endpoint (HTTP
  latency, SSE clients, MCP tool calls, job outcomes, storage gauges)
- Idempotent, restart-safe scheduled jobs: waiting-lane aging alerts, 90-day Done archival,
  fractional-key rebalancing, session purge, and nightly SQLite snapshots
- Docker multi-stage build with health checks and restart policies; optional Litestream continuous
  WAL backup to S3-compatible storage (SQLite) or standard `pg_dump`/WAL archiving (PostgreSQL)
- Structured pino JSON logging to stdout with request IDs and automatic redaction of secrets,
  tokens, and cookies

### Security

- Argon2id password hashing with per-user salts, a 12–128 character policy, and rejection of the 10k
  most common passwords
- Brute-force defenses: per-account exponential backoff, login rate limiting, timing-safe
  verification against user enumeration, and fresh session IDs on every login
- Session cookies hardened with `httpOnly`, `Secure`, `SameSite=Lax`, and the `__Host-` prefix;
  session IDs hashed at rest
- Layered CSRF protection (SameSite cookie + JSON Content-Type enforcement + `X-Requested-With` for
  multipart requests)
- Optimistic locking via a card `version` column (`If-Match`/ETag on REST, `expectedVersion` on MCP
  tools) returning `409 Conflict` on mismatch
- Upload validation by magic-byte MIME sniffing (PNG, JPEG, WebP, HEIC, PDF) with per-file,
  per-card, per-user-daily, and global size limits, plus filename sanitization on download
- Rate limits with `Retry-After` across the API, login, uploads, MCP, and SSE
- OAuth 2.1 authorization server for agents with mandatory PKCE, dynamic client registration, opaque
  access tokens, rotating refresh tokens, a per-client consent screen, and audience-bound resource
  metadata on `/mcp`
- Content Security Policy with no inline script, HSTS, `frame-ancestors none`, and `nosniff`
- Zod-validated request and response schemas in strict mode on every route, so secrets and hashes
  are structurally unable to leak; all SQL parameterized through Drizzle
- Immutable, append-only audit trail (no updates or deletes on events; PII removal via tombstones)
  preserving a tamper-evident record of every change

[Unreleased]: https://github.com/po-trottier/ai-kanban/compare/v1.0.2...HEAD
[1.0.2]: https://github.com/po-trottier/ai-kanban/releases/tag/v1.0.2
[1.0.1]: https://github.com/po-trottier/ai-kanban/releases/tag/v1.0.1
[1.0.0]: https://github.com/po-trottier/ai-kanban/releases/tag/v1.0.0
