# ADR-021: First-party OAuth 2.1 — agent auth, external IdP sign-in, on-behalf-of audit

**Status**: proposed (2026-07-20) — research + design for PO review; not yet implemented.

## Context

Today (ADR-009): the web uses server-side sessions; MCP uses **admin-issued bearer service
tokens** (`rkb_…`, sha256-hashed, role-scoped, revocable). Three gaps the PO wants closed:

1. **Manual token handoff.** An agent (Claude Code, Codex) can only reach `/mcp` after a human
   mints a token in Settings and pastes it into a config file (see `/llms.txt`). Friction, and a
   long-lived secret in plaintext on disk.
2. **No corporate sign-in.** Only local email+password accounts exist. The PO wants Microsoft
   Entra ID (Azure AD / "Microsoft SSO"), Google, etc. — while keeping hand-made accounts.
3. **No on-behalf-of attribution.** An MCP action is audited as `actor_kind: 'mcp'`, `id =`
   the _token's_ id, with the token's _own_ admin-assigned role. It is not tied to a person,
   so we cannot log "**Codex on behalf of P-O**", and an agent's authority is decoupled from
   its operator's.

ADR-009 explicitly deferred this: _"the MCP auth spec's full OAuth resource-server behavior
(RFC 9728 metadata, IdP-issued tokens) is adopted at the OIDC cutover, when an authorization
server actually exists,"_ and _"OIDC replaces \[the login handler] (code flow → find-or-create
user → same session issuance); sessions, the policy engine, and every downstream consumer are
unchanged."_ This ADR designs that authorization server (AS).

**Hard constraints (PO):** everything first-party — **no external SaaS for our own authz** — but
able to **federate** human sign-in to external OIDC providers. Local accounts keep working.
Single-node deployment (ADR-009) still holds, which shapes the token-format choice below.

## Requirements

- R1. An agent connects to `/mcp` by **triggering an auth flow** — the human approves in a
  browser and **copies nothing**. No long-lived secret on disk.
- R2. Sign-in works via **local password** _or_ a **corporate account** (Entra ID / Google / any
  OIDC IdP). Federation is for authentication only; we remain the sole token issuer for `/mcp`.
- R3. We host the whole thing — **no third-party authorization server**.
- R4. An agent **acts on behalf of the user** and every action is audited as
  **"Codex on behalf of P-O"**, bounded by the **user's** permissions (never more).
- R5. Compatible with the existing user/role/session/policy model and the audit trail (ADR-005).

## Research summary — the standards this must satisfy

**MCP Authorization** (spec 2025-06-18, reaffirmed 2025-11-25). The MCP server is an **OAuth 2.1
Resource Server only**; a separate **Authorization Server** issues tokens (it _"may be hosted with
the resource server or a separate entity"_ — we co-host). Concretely the RS/AS MUST:

- RS implements **RFC 9728 Protected Resource Metadata** at
  `/.well-known/oauth-protected-resource`, whose `authorization_servers` names the AS. On an
  unauthenticated request the RS returns **401 with a `WWW-Authenticate: Bearer
resource_metadata="…"`** header (RFC 9728 §5.1) so the client can discover the AS.
- AS provides **RFC 8414 Authorization Server Metadata** at
  `/.well-known/oauth-authorization-server` (endpoints + capabilities).
- AS + client **SHOULD** support **RFC 7591 Dynamic Client Registration** (`POST /register`) so an
  agent gets a `client_id` with no human pre-registration.
- Clients **MUST** use **PKCE** (OAuth 2.1) and **MUST** send the **RFC 8707 `resource`** parameter
  (the canonical `/mcp` URI) on both authorize and token requests; the RS **MUST** validate the
  token's **audience** is itself (no cross-service reuse, no token passthrough).
- Redirect URIs **MUST** be `localhost`/loopback or HTTPS, **exact-match** registered. Access tokens
  **SHOULD** be short-lived; public clients **MUST** rotate refresh tokens.

The redirect (authorization-code + PKCE) flow **is** R1: the client opens the browser, the user
approves against their existing session, the AS redirects to the client's loopback callback with a
code, the client exchanges code+verifier for a token. Nothing is copied by hand. Claude Code and
Codex already implement this MCP OAuth client flow (dynamic registration + loopback).

**On-behalf-of** (R4). A plain authorization-code token makes the agent indistinguishable from the
user — no agent audit trail. **RFC 8693 Token Exchange** defines the **`act` (actor) claim**:
`sub` = the user (resource owner), `act.sub` = the agent, with nesting for delegation chains — this
is _delegation_, not impersonation (the agent keeps its own identity while representing the user).
The emerging **`draft-oauth-ai-agents-on-behalf-of-user`** adds `requested_actor`/`actor_token`
for exactly this AI-agent case. We don't need full token exchange on day one: the authorization-code
token already binds `sub` = the consenting user and `client_id` = the registered agent, which is
enough to render "agent on behalf of user". We adopt the `act`-claim vocabulary so the model
extends cleanly to delegation chains later.

**External IdP** (R2). Our AS acts as an **OIDC Relying Party** to Entra ID / Google. On successful
external login we **find-or-create** the local user by verified email and issue our **own** session
— exactly ADR-009's "code flow → find-or-create → same session issuance". Federation is an
_authentication_ source behind our AS; it never becomes the `/mcp` token issuer (R3 preserved).

## Decision — target architecture

### A. `/mcp` becomes an OAuth 2.1 Resource Server

Add RFC 9728 metadata + `WWW-Authenticate` discovery + RFC 8707 audience validation to the MCP
mount. Bearer validation moves from "hash-and-look-up-a-service-token" (`mcp-auth.ts`) to
"validate an access token issued by our AS for the `/mcp` audience" — but both resolve to the same
downstream **`Actor`**, so services, tools, and the policy engine are untouched.

### B. A first-party Authorization Server, co-located with the app

New Fastify routes under `/oauth` (all HTTPS in prod; loopback allowed in dev):

- `GET /.well-known/oauth-authorization-server` (RFC 8414)
- `POST /oauth/register` (RFC 7591 dynamic client registration; open registration for public
  loopback clients, with per-client consent — see Security)
- `GET /oauth/authorize` — the **login + consent** surface. Reuses the existing session: if the
  user isn't signed in, it routes through the normal login (local password **or** external OIDC),
  then shows a consent screen ("**Codex** wants to act on your behalf: read / read+write").
- `POST /oauth/token` — authorization-code (+PKCE) and refresh-token grants.
- `POST /oauth/revoke` (RFC 7009).

The AS and the web app share the same user table and session cookie, so "approve in the browser"
is one click when the operator is already logged in.

### C. Token format: **opaque + DB lookup** (PO: "don't care" → take the ADR-009-consistent one)

ADR-009 chose stateful sessions over JWTs specifically for **instant revocation, no signing-key
rotation, and single-node simplicity** — one indexed SQLite read per request is free at this scale.
The same logic applies to access tokens. Decision: **opaque access tokens, sha256-hashed at rest**
(like sessions and today's service tokens), validated by a `read` UoW lookup on every `/mcp` call.

**TTL + refresh (PO: "whatever's recommended, but an easy refresh so agents don't constantly
re-auth").** Standard OAuth 2.1 shape: a **short-lived access token** (~1 h) plus a **long-lived,
rotating refresh token** (~30–60 days sliding). The MCP client refreshes **silently** in the
background (`refresh_token` grant) — the human authorizes **once**, and the agent keeps working for
weeks without another browser round-trip; it only re-auths if the refresh token expires unused or is
revoked (logout / deactivate / "sign out this agent"). Refresh-token **rotation** (each use issues a
new one and invalidates the old) is mandatory for public clients per the spec, so a stolen refresh
token is detectable (reuse ⇒ revoke the whole chain).

_Alternative not taken:_ signed **JWT access tokens (RFC 9068)** with the `act` claim inline —
self-validating, no per-request DB read, but reintroduces signing-key management and a revocation
list, the exact costs ADR-009 rejected. Deferred unless/until multi-node (see ADR-020 Postgres path)
makes stateless validation worth it. Either way the wire contract is a bearer token; the RS abstracts
the format.

### D. Human authentication: local **or** federated — **invited users only** (PO)

`external_identities (provider, subject) → user`. Local password stays the default; an admin enables
an OIDC provider (issuer URL + client credentials in env, validated at boot like every other secret).

**No auto-provisioning (PO: "invited users only, role chosen at invite time, like Sentry").** An
admin **invites** an email and picks the **role** on the invite; that mints a pending user with the
role baked in. External (or local) sign-in then only ever **binds an identity to a pre-invited
user** — a verified email with no matching invite/user is **rejected**, never silently created. So
Entra/Google decide _authentication_ ("is this really alice@corp"), while _authorization_ (who may
in, and as what role) stays entirely ours. This is additive to ADR-009 — the login _handler_ gains a
second credential source; **sessions, policy, and downstream are unchanged.**

### D′. Invites + password reset via shareable links — **no email server** (PO)

Invited-only onboarding needs a way to reach the invitee — but **not** an email server (PO: "drop
it entirely, it complicates everything"). Do it the way **Discord invites** work: the admin action
**mints a signed, single-use, expiring link**; the admin shares it out-of-band (Slack, email, in
person — the app never sends anything). The recipient opens it and finishes setup themselves.

- **Invite** — admin invites an email + role → a pending user + an `invite_token` → a link
  (`<origin>/accept-invite?token=…`) the admin copies and sends. Opening it lets the invitee **set a
  local password and/or sign in with Google/Entra** (which binds the external identity to the
  pre-invited account); the account then activates with the admin-chosen role.
- **Password reset — no self-service email.** A federated user just re-authenticates through their
  IdP (Google/Entra own "forgot password"). For a local account, an admin's **"reset password"**
  mints the same kind of link (replacing today's hand-typed temp password, `security.md`). That
  covers the forgot-password case without the app ever sending mail.

Cost: signed tokens + two routes (`accept-invite`, `reset`), **zero SMTP / deliverability surface**.
If self-service email reset is ever wanted, a `core` `Mailer` port can be added later — explicitly
**out of scope** now.

### D″. Home-realm discovery: route corporate emails straight to their IdP (PO)

The login UX the PO wants is standard **home-realm discovery** (what Microsoft / Okta / Google
Workspace portals do): the user types only their email and is bounced to their company's sign-in.

- **Trigger.** When the login email field's edit **ends** (Enter, Tab, or blur), the SPA takes the
  email's **domain** and asks a cheap unauthenticated `GET /auth/idp?domain=<d>` (which returns the
  matching provider or nothing — it reveals only whether a _domain_ is SSO-enrolled, never whether an
  account exists, so it's not an enumeration oracle). On a match it **redirects to that IdP's OIDC
  authorization URL** (the corporate portal); the password field never appears. No match ⇒ fall
  through to the normal local-password field.
- **Configured in Settings → Users (PO).** An admin (with `manageUsers`) maps **`domain → provider`**
  (e.g. `corp.example → Entra tenant`) in the Users tab — a small table of rows, each pointing at one
  of the configured OIDC providers. The same mapping also drives which IdP an invite-accept binds to.
- **Feasible now?** Yes — the discovery + Settings config is a thin layer (one `sso_domains` table,
  one lookup route, a blur handler on the login email field). But the redirect only _goes_ somewhere
  once the OIDC provider from §D exists, so it ships **with** the federation (Phase 2), not before —
  a redirect to an IdP we haven't wired up would go nowhere.

### E. Actor / on-behalf-of model

Extend the `core` `Actor` (today `{ kind, id, role, scope? }`) with an **agent** shape:

```
{ kind: 'agent', id: <userId>, role: <the user's role>, scope: 'read' | 'read_write',
  onBehalfOf: { userId, displayName }, client: { id, name } }   // name e.g. "Codex"
```

Key properties: the agent's **`id`/`role` are the USER's** — so the policy engine already bounds the
agent to its operator's permissions (R4), and the always-on identity rules (read-scope-can't-write,
comment-author-only, system-bypass) apply unchanged. The audit event records `actor_kind: 'agent'`
plus `client.name` + `onBehalfOf`, and the UI/history renders **"Codex on behalf of P-O"**. Consent
may **narrow** scope below the user's role (e.g. a read-only agent), never widen it. `ACTOR_KINDS`
gains `'agent'`; the audit renderer and history strings learn the new phrasing.

### F. What stays: admin service tokens for **user-less** service accounts

Slack's bot and CI/automation are legitimately person-less; they keep today's admin-issued
`rkb_` tokens (kind `'mcp'`). The OAuth path is for **interactive agents acting for a human**. The
`/mcp` RS accepts both during and after migration. `/llms.txt` switches from "mint + paste a token"
to "trigger the OAuth flow" for agents, keeping the manual path documented only for headless service
accounts.

## Data model (new tables, all secrets hashed at rest like `sessions`)

- `oauth_clients` — dynamically-registered clients: `client_id`, `client_name`, redirect URIs
  (exact-match), `created_at`, optional `client_secret_hash` (confidential clients only).
- `oauth_authorization_codes` — short-lived (~60 s), single-use: code hash, `client_id`, `user_id`,
  `resource`, `scope`, PKCE `code_challenge`+method, `redirect_uri`, `expires_at`.
- `oauth_access_tokens` / `oauth_refresh_tokens` — hashed token, `user_id`, `client_id`, `scope`,
  `resource/aud`, `expires_at`, `revoked_at`, `last_used_at` (throttled, like today).
- `external_identities` — `provider`, `subject`, `user_id`, `linked_at` (federation).

## Security considerations

Everything in `security.md` still applies; additions specific to OAuth:

- **Audience binding** (RFC 8707): tokens are minted for the canonical `/mcp` URI; the RS rejects any
  token whose `aud`/`resource` isn't itself. **No token passthrough** to upstreams.
- **PKCE mandatory**; **exact** redirect-URI match; `state` required; loopback/HTTPS only.
- **Consent per client**: dynamic registration is open (required for agents), so the _consent_ screen
  — not registration — is the trust gate; it names the client and the scope, and defends the
  confused-deputy case (MCP spec §"Confused Deputy").
- **Short-lived access tokens + rotating refresh tokens**; opaque + hashed so leak-blast-radius is
  minutes and revocation is a row delete (logout/deactivate/role-change cascade to the user's tokens,
  matching session revocation).
- **Agent ≤ operator**: permissions come from the user's role; consent can only narrow scope. A
  deactivated or demoted user instantly disables their agents' tokens.
- **Rate limits**: the `/oauth/token` + `/oauth/register` endpoints get their own buckets alongside
  the existing login/MCP buckets; registration is abuse-throttled per IP.
- **Federation**: external IdP client secrets are env-only (boot-validated, pino-redacted); we verify
  `iss`/`aud`/`nonce`/signature on ID tokens; email must be verified before find-or-create.

**Implementation note — burn/revoke must COMMIT, not roll back (phase-1 `TokenService`).** A
`UnitOfWork.run` that throws ROLLs its whole transaction back (`SqliteUnitOfWork`). So the two
single-use/anti-replay writes cannot share a transaction with the rejection they cause: (1) the
authorization-code `consume` runs in its own committed transaction BEFORE PKCE/expiry/client
validation, so a code is burned on ANY exchange attempt — a PKCE-failed retry finds nothing, closing
the verifier-brute-force oracle; (2) refresh-token reuse detection commits the `revokeFamily` +
access-token revoke and returns a "reuse" marker, and the `invalid_grant` is thrown AFTER the
transaction commits — throwing inside it would roll the family revocation back and leave the stolen
chain alive. Both paths have unit tests (`token-service.unit.test.ts`).

## Phased delivery

1. **RS + minimal AS, local accounts.** RFC 9728 metadata + `WWW-Authenticate` on `/mcp`; AS with
   RFC 8414 metadata, dynamic registration, authorize/consent (over the existing session + local
   login), token endpoint, PKCE, opaque tokens; **`agent` Actor + on-behalf-of audit**. Delivers
   R1, R3, R4, R5. Agents stop copying tokens.
2. **External OIDC federation + invited-only onboarding.** AS-as-RP to Entra ID / Google;
   `external_identities`; invite-accept + reset links (§D′); **home-realm discovery** on the login
   email field + the `domain → provider` map in Settings → Users (§D″). Delivers R2.
3. **Deprecate manual agent tokens.** Keep `rkb_` only for headless service accounts; update
   `/llms.txt` + Settings; optionally add RFC 8693 token exchange for multi-hop delegation chains.

## Alternatives considered

- **Embed Ory Hydra / Keycloak** as the AS. Rejected per R3 (first-party, minimal, single-node) —
  a large operational dependency for a deliberately small deployment. The AS surface we need is a
  well-bounded subset of OAuth 2.1; building it against the pinned MCP SDK is the ADR-001
  "build-vs-reuse" call. Revisit if enterprise IdP breadth outgrows a hand-rolled AS.
- **JWT (RFC 9068) access tokens** — see §C; deferred to keep ADR-009's revocation/simplicity wins on
  single-node.
- **Keep manual tokens for everyone** — rejected: fails R1/R4 (friction + no on-behalf-of).

## Consequences

A real authorization-server surface (endpoints, four tables, a consent screen, an `agent` Actor and
audit phrasing) enters the server — the largest addition since sessions. It is **additive**: the
policy engine, services, session cookie, and audit trail are reused unchanged, and headless service
tokens remain.

**Decisions (PO, 2026-07-20):**

- **Token format** — opaque, DB-backed (§C). Access ~1 h; **rotating refresh** ~30–60 days, silent
  refresh so an authorized agent doesn't re-auth for weeks.
- **Onboarding** — **invited users only**, role chosen on the invite (Sentry-style); external sign-in
  binds to a pre-invited user, never auto-creates (§D). **No email server** (§D′): invites + admin
  password resets are **shareable single-use links** (Discord-style) the admin sends out-of-band;
  federated users reset via their IdP.
- **External IdP** — plain OIDC so it drops into Microsoft Entra ID / Google / any standard provider
  with just an issuer URL + client credentials (PO: "easy to integrate with industry-standard
  systems"). We stay the sole `/mcp` token issuer; the IdP only authenticates the human.
- **Agent consent** — the one-time browser approval screen where the human authorizes a specific
  client + scope (see below); **remembered per `(user, client, scope)`** so re-connecting the same
  agent is silent, re-prompting only on a new client or a scope increase. Revocable in Settings.

_Agent consent, defined:_ when an agent first hits the OAuth flow, after the human signs in the AS
shows a **consent screen** — "**Codex** wants to act as **you** on Rivian Kanban: **read / read +
write**. Allow?" It's the moment the human grants a named client permission to act on their behalf
(and picks/limits the scope). Approving records a grant so future connections by that same client are
silent; the human can revoke it anytime (which kills that agent's tokens). It is the human-in-the-loop
gate that replaces today's manual token paste — the "copy nothing" step that is still an explicit
authorization, not an automatic one.
