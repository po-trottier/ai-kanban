# Security

Threat model: internal tool holding personnel names, vendor details, and facility information;
reachable by 100+ employees; exposed surfaces are the SPA/REST, the MCP endpoint, and outbound
Slack/Anthropic calls. Every control below is enforced by code or CI, not convention.

## Authentication

- **Web**: email + password (argon2id, per-user salt, tuned params) → server-side session:
  256-bit random id, stored **sha256-hashed** (the cookie is the only place the raw id exists),
  httpOnly + Secure + SameSite=Lax cookie, sliding expiry (7 days idle, 30 days absolute).
  No cookie signing — the id is already unforgeable randomness. A fresh session id is issued
  at every login (anti-fixation); logout, password change, role change, and admin deactivation
  revoke immediately — the reason sessions beat JWTs here
  ([ADR-009](decisions/ADR-009-sessions-and-tokens.md)).
- **Password lifecycle**: users change their own password (`POST /auth/change-password`,
  requires the current password, revokes other sessions); admins issue one-time temp passwords
  on create/reset; `must_change_password` restricts the session to the change-password flow
  until cleared. Policy: 12–128 chars, no composition rules (NIST-style), top-10k common
  passwords rejected. Login verifies a static dummy argon2 hash when the email is unknown so
  response timing does not enumerate users; error messages are uniform.
- **MCP**: admin-issued bearer service tokens — scope (`read`/`read_write`) enforced as an
  always-on identity rule, sha256-hashed at rest, revocable, `last_used_at` tracked, never
  anonymous. Details in [mcp.md](mcp.md#authentication).
- **Slack**: Bolt Socket Mode authenticates via Slack's own tokens; the workspace `team_id` is
  pinned, users map by verified email once then by stored id, and `is_active` is required —
  see [slack.md](slack.md#identity-mapping).
- Login endpoint: strict rate limit (see table below) **plus** per-account exponential backoff
  (1 s doubling, capped at 60 s, reset on success) so neither IP rotation nor a single IP can
  brute-force; backoff, not hard lockout, so accounts can't be DoS'd shut.

## Authorization

One policy engine in `core`, consulted by services (not adapters), so no REST route, MCP tool,
or Slack listener can bypass it. The model — permissive by default, hierarchy as opt-in
configuration — is defined once in
[ADR-013](decisions/ADR-013-configurable-permissions.md) (canonical, including the policy
document schema) and [workflow.md](../product/workflow.md#movement-policy-permissive-by-default).

What is security-relevant here:

- **Always-on rules the policy cannot open**: the admin surface (users, lanes, policy,
  locations, service tokens) is admin-role-only — it is where permissions are configured;
  comment editing is author-only (impersonation prevention); `read`-scoped MCP tokens cannot
  write; the last active admin can never be demoted or deactivated (409, named rule —
  prevents lockout of the only restricted surface; break-glass recovery is the bootstrap CLI
  in deployment.md).
- Policy documents are Zod-validated, stored as append-only versions (configuration has an
  audit history), cached in-process, invalidated on update.
- Denials: 403 with the failed gate named; illegal lane transitions (enforcement on) are 422.
  Both are logged.

## Input & output

- Zod validation on **every** route (boot-time hook makes missing schemas fatal), strict mode:
  unknown keys rejected. Length caps on all strings; markdown stored raw, sanitized at render
  (frontend renders markdown with a sanitizing renderer — no `dangerouslySetInnerHTML` of user
  content; CSP as backstop).
- Response serialization through Zod schemas — secrets/hashes are structurally unable to leak.
- SQL exclusively through Drizzle's parameterized query builder; raw SQL is lint-banned outside
  the `db` package and reviewed there.

## Web platform hardening

- `@fastify/helmet`: CSP (`default-src 'self'`, no inline script), HSTS (behind TLS proxy),
  `X-Content-Type-Options`, frame-ancestors none.
- CORS: same-origin deployment (server serves the SPA), so the allowlist is empty by default;
  any cross-origin consumer must be explicitly configured.
- CSRF, layered: SameSite=Lax cookie + **all** state-changing routes require either
  `Content-Type: application/json` (checked before body parsing; missing header rejected) or,
  for multipart uploads and bodyless POSTs (logout, reopen, block/unblock), a custom
  `X-Requested-With` header. DELETEs additionally trigger CORS preflight by method. HTML forms
  can produce none of these. Note: SameSite is same-*site*, not same-origin — a compromised
  sibling subdomain bypasses Lax, which is why the header/content-type layer is mandatory, not
  belt-and-braces.
- Rate limiting (429 + `Retry-After`; initial budgets, tuned later):

  | Bucket | Limit | Keyed on |
  | --- | --- | --- |
  | Global | 300/min | IP |
  | Login | 5/min | IP (plus per-account backoff above) |
  | Uploads | 20/min | user |
  | MCP | 120/min | token id |
  | SSE | 5 concurrent streams (oldest dropped) | user |

  Per-IP limits assume correct client-IP derivation behind the TLS proxy — see the
  trust-proxy requirement in [deployment.md](deployment.md). Slack traffic arrives over
  Socket Mode and never hits these buckets; the Bolt adapter enforces its own throttles
  ([slack.md](slack.md#delivery-semantics--abuse-controls)).
- `@fastify/under-pressure` sheds load (503) under event-loop distress instead of collapsing.

## Uploads

- MIME sniffed from magic bytes (`file-type`), not the client header or extension; allowlist:
  `image/png, image/jpeg, image/webp, image/heic, application/pdf`.
- **The server never decodes or transforms uploaded bytes** (no thumbnails, no image parsing) —
  this invariant is what keeps image-parser CVEs (e.g. HEIF libraries) out of scope. Any future
  image processing requires a security review and sandboxing.
- Limits: 25 MB/file, 10 active files/card (enforced in the insert transaction), one file per
  request; @fastify/multipart hard limits on part count and field sizes. Quotas against
  disk-fill DoS: 500 MB/day per user, plus a global `BLOB_DIR` high-water mark that rejects
  uploads with 507 while headroom remains for SQLite+WAL on the shared volume.
- Blobs stored under random UUID keys (original filename only in DB metadata — no path
  traversal surface). Downloads: `Content-Disposition: attachment` with the filename sanitized
  (CR/LF/quotes stripped, ASCII fallback + RFC 5987 `filename*`), `nosniff`. Blob directory
  has no execute permissions.

## Secrets & configuration

Env-only, validated by Zod at boot, never logged (pino redaction list includes tokens, cookies,
authorization headers, password fields). No secrets in the repo, image, or client bundle.
CI runs gitleaks (secret scanning), `npm audit --omit=dev --audit-level=high`, and OSV-Scanner;
Dependabot with majors held for deliberate upgrade.

## Audit & observability

Every mutation carries an `Actor` (`user | mcp | slack | system`) into the same-transaction
audit event. Sessions and service tokens record last use. `/metrics` (Prometheus) is served on
an internal-only listener; health endpoints expose no data.

**Tamper-evidence boundary, stated honestly**: the audit trail is append-only against every
application actor (web, MCP, Slack — no code path updates or deletes events). It is *not*
tamper-proof against host or volume compromise; SQLite has no grants. The compensating control
is Litestream's continuous off-host replication — already-shipped WAL history cannot be
rewritten retroactively. Event hash-chaining is a noted Postgres-era hardening option.

## Dependency & supply chain

Exact-pinned versions (`save-exact`), lockfile committed, `npm ci` only in CI, GitHub Actions
SHA-pinned, no postinstall scripts from untrusted packages (`ignore-scripts` + explicit
allowlist for better-sqlite3/argon2 builds).
