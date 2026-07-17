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

## Authorization

One policy engine in `core`, consulted by services (not adapters), so no surface can bypass it.
It evaluates the **configured permission policy** — permissive by default, tightened by admins
([ADR-013](decisions/ADR-013-configurable-permissions.md)).

**Defaults (out of the box):**

| Capability | Who |
| --- | --- |
| View board, cards, history, comments; create cards/comments; edit cards; move/reorder anywhere; attach files; block/unblock; cancel; reopen | any authenticated user |
| Edit own comment | author only (identity rule, not RBAC — impersonation prevention) |
| Delete a comment | author (others' — via policy gate only) |
| Manage users, lanes, permission policy, locations, service tokens | **admin only — the single role-restricted surface by default**, and never openable: it is where permissions are configured |

**Configurable gates (admin settings view):** transition enforcement (activates the seeded
workflow graph), per-transition minimum roles, and action gates (approve, close review→done,
cancel any, reopen, reorder Ready, delete others' comments). Roles
(`requester < technician < supervisor < admin`) exist as assignable levels that these gates
reference; they impose nothing until a gate is enabled.

Policy documents are Zod-validated and stored as **append-only versions** (who changed what,
when — configuration has an audit history too). The active policy is cached in-process and
invalidated on update.

Policy denials are 403 with the failed gate named; illegal lane transitions (enforcement on)
are 422. Both are logged.

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
