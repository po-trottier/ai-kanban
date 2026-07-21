import { z } from 'zod'
import { tokenScopeSchema } from './entities.ts'

/**
 * OAuth 2.1 authorization-server REQUEST schemas (ADR-021, phase 1). Owned by
 * core so the single shape drives both the slice-4 REST routes' validation and
 * the server-side authorization/token/registration services (single-schema
 * rule, docs/dev/standards.md). Pure Zod — no IO, no framework.
 *
 * Deliberate non-strictness at the wire boundary: agents (Claude Code, Codex)
 * send extra OAuth params we don't consume (`state`, `nonce`, `response_type`),
 * so these are plain objects, not `strictObject` — an unknown field is ignored,
 * never a 400.
 */

/** PKCE method — S256 ONLY (OAuth 2.1; `plain` is rejected). */
export const pkceMethodSchema = z.literal('S256')

/**
 * The validated `GET /oauth/authorize` request (the fields the AS consumes to
 * mint an authorization code). `resource` is the RFC 8707 audience (the `/mcp`
 * URI); it is canonicalized server-side before being bound to the code.
 */
export const authorizeRequestSchema = z.object({
  clientId: z.string().min(1),
  redirectUri: z.string().min(1),
  resource: z.string().min(1),
  scope: tokenScopeSchema,
  codeChallenge: z.string().min(1),
  codeChallengeMethod: pkceMethodSchema,
})
export type AuthorizeRequest = z.infer<typeof authorizeRequestSchema>

/**
 * `POST /oauth/token`, authorization_code grant. `redirectUri` is re-sent and
 * re-checked against the code's bound value (OAuth 2.1). `resource` is
 * optional: the token's audience is bound from the CODE, not this field.
 */
export const tokenCodeGrantSchema = z.object({
  grantType: z.literal('authorization_code'),
  code: z.string().min(1),
  codeVerifier: z.string().min(1),
  clientId: z.string().min(1),
  redirectUri: z.string().min(1),
  resource: z.string().min(1).optional(),
})
export type TokenCodeGrant = z.infer<typeof tokenCodeGrantSchema>

/**
 * `POST /oauth/token`, refresh_token grant. `resource` is deliberately optional
 * and NOT required — Codex omits it (OpenAI Codex #33403); the audience is bound
 * from the STORED refresh row. No `clientId` min-length beyond non-empty.
 */
export const tokenRefreshGrantSchema = z.object({
  grantType: z.literal('refresh_token'),
  refreshToken: z.string().min(1),
  clientId: z.string().min(1),
  resource: z.string().min(1).optional(),
})
export type TokenRefreshGrant = z.infer<typeof tokenRefreshGrantSchema>

/** The token endpoint accepts either grant, discriminated on `grantType`. */
export const tokenRequestSchema = z.discriminatedUnion('grantType', [
  tokenCodeGrantSchema,
  tokenRefreshGrantSchema,
])
export type TokenRequest = z.infer<typeof tokenRequestSchema>

/** The token endpoint response body (RFC 6749 §5.1). */
export const tokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  token_type: z.literal('Bearer'),
  expires_in: z.number().int().positive(),
  scope: tokenScopeSchema,
})
export type TokenResponse = z.infer<typeof tokenResponseSchema>

/**
 * `POST /oauth/register` (RFC 7591 dynamic client registration), OPEN — no
 * auth. Snake_case because it is the RFC 7591 wire body verbatim; each
 * redirect URI must be HTTPS or loopback (validated in the service).
 */
export const registerClientRequestSchema = z.object({
  // Open (unauthenticated) registration, so cap the inputs: at most 8 redirect
  // URIs, each ≤ 2048 chars, so a caller can't amplify never-expiring client
  // rows into a storage / linear-scan DoS (the route also rate-limits per IP).
  redirect_uris: z.array(z.string().min(1).max(2048)).min(1).max(8),
  client_name: z.string().min(1).max(255).optional(),
})
export type RegisterClientRequest = z.infer<typeof registerClientRequestSchema>

/** The RFC 7591 registration response body. */
export const registerClientResponseSchema = z.object({
  client_id: z.string(),
  redirect_uris: z.array(z.string()),
  client_name: z.string().optional(),
  token_endpoint_auth_method: z.literal('none'),
})
export type RegisterClientResponse = z.infer<typeof registerClientResponseSchema>
