# ADR-009: Server-side sessions for the web; bearer service tokens for MCP

**Status**: accepted (2026-07-16)

## Context

Pilot auth is local accounts (PO decision) with OIDC/SSO later. Research suggested
@fastify/jwt; the choice deserved scrutiny.

## Decision

- **Web: server-side sessions**, not JWTs. Random 256-bit id in an httpOnly/Secure/SameSite=Lax
  cookie, stored hashed in the `sessions` table, sliding expiry. Rationale: instant revocation
  (logout, deactivation), no signing-key rotation, no refresh-token dance, trivially correct —
  and one extra indexed SQLite read per request is free at this scale. JWT's stateless-scaling
  benefit is worthless on a deliberately single-node deployment.
- **MCP: bearer service tokens** (admin-issued, sha256-hashed, role-scoped, revocable). The
  MCP auth spec's full OAuth resource-server behavior (RFC 9728 metadata, IdP-issued tokens)
  is adopted at the OIDC cutover, when an authorization server actually exists — that cutover is
  now designed in [ADR-021](ADR-021-oauth-authorization-server.md) (proposed: a first-party
  OAuth 2.1 AS, agent auth without manual token copy, and on-behalf-of audit).
- **OIDC-ready**: the login handler is the only component that knows about passwords —
  password change and admin reset live in the same handler family. OIDC replaces them
  (code flow → find-or-create user → same session issuance); sessions, the policy engine, and
  every downstream consumer are unchanged. Federation to external IdPs (Entra ID, Google) is
  specified in [ADR-021](ADR-021-oauth-authorization-server.md).

## Consequences

A `sessions` table and periodic purge job. No JWT libraries in v1. Slack actors never get
sessions — Bolt resolves them per-event to an `Actor` by verified email
(see slack.md#identity-mapping).
