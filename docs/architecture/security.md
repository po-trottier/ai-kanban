# Security

Threat model: internal tool holding personnel names, vendor details, and facility information;
reachable by 100+ employees; exposed surfaces are the SPA/REST, the MCP endpoint, and outbound
Slack/Anthropic calls. Every control below is enforced by code or CI, not convention.

## Authentication

- **Web**: email + password (argon2id, per-user salt, tuned params) → server-side session:
  256-bit random id, stored **hashed**, httpOnly + Secure + SameSite=Lax cookie, sliding
  expiry (7 days idle, 30 days absolute). Logout and admin deactivation revoke immediately —
  the reason sessions beat JWTs here ([ADR-009](decisions/ADR-009-sessions-and-tokens.md)).
- **MCP**: admin-issued bearer service tokens, sha256-hashed at rest, role-scoped, revocable,
  `last_used_at` tracked. Never anonymous.
- **Slack**: Bolt Socket Mode authenticates via Slack's own tokens; our app resolves the acting
  Slack user to a local user by verified email. Unknown Slack users are rejected with a
  friendly "ask an admin" message.
- Login endpoint: strict rate limit (5/min/IP + exponential backoff per account), uniform
  error message (no user enumeration), no lockout DoS (backoff, not hard lock).

## Authorization (RBAC)

One policy module in `core`, consulted by services (not adapters), so no surface can bypass it.

| Capability | requester | technician | supervisor | admin |
| --- | :-: | :-: | :-: | :-: |
| View board, cards, history, comments | ✔ | ✔ | ✔ | ✔ |
| Create card / comment / reply | ✔ | ✔ | ✔ | ✔ |
| Edit own card while in intake/waiting_approval | ✔ | ✔ | ✔ | ✔ |
| Cancel own card while in intake/waiting_approval | ✔ | ✔ | ✔ | ✔ |
| Edit card fields; attach files; block/unblock | | ✔ | ✔ | ✔ |
| Execute transitions per [matrix](../product/workflow.md#transition-matrix) | | ✔ | ✔ | ✔ |
| Approve (waiting_approval → ready) | | | ✔ | ✔ |
| Verify/close (review → done), cancel any, reopen, reorder ready | | | ✔ | ✔ |
| Edit/delete others' comments (delete only) | | | ✔ | ✔ |
| Manage users, lanes, locations, service tokens | | | | ✔ |

Policy denials are 403 with the failed rule named; illegal lane transitions are 422. Both are
audited nowhere (no event) but logged.

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
- CSRF: state-changing routes require `Content-Type: application/json` (forms can't send it
  cross-site) + SameSite=Lax cookie; multipart upload routes additionally require a custom
  `X-Requested-With` header.
- Rate limiting: global per-IP budget plus stricter buckets on auth, upload, and MCP.
- `@fastify/under-pressure` sheds load (503) under event-loop distress instead of collapsing.

## Uploads

MIME sniffed from magic bytes (`file-type`), not the client header or extension; allowlist:
`image/png, image/jpeg, image/webp, image/heic, application/pdf`. 25 MB/file, 10 files/card.
Blobs stored under random UUID keys (original filename only in DB metadata — no path traversal
surface). Downloads: `Content-Disposition: attachment`, `nosniff`. Blob directory is a separate
volume with no execute permissions.

## Secrets & configuration

Env-only, validated by Zod at boot, never logged (pino redaction list includes tokens, cookies,
authorization headers, password fields). No secrets in the repo, image, or client bundle.
CI runs gitleaks (secret scanning), `npm audit --omit=dev --audit-level=high`, and OSV-Scanner;
Dependabot with majors held for deliberate upgrade.

## Audit & observability

Every mutation carries an `Actor` (`user | mcp | slack | system`) into the same-transaction
audit event. Sessions and service tokens record last use. `/metrics` (Prometheus) is bound to
the internal interface; health endpoints expose no data.

## Dependency & supply chain

Exact-pinned versions (`save-exact`), lockfile committed, `npm ci` only in CI, GitHub Actions
SHA-pinned, no postinstall scripts from untrusted packages (`ignore-scripts` + explicit
allowlist for better-sqlite3/argon2 builds).
