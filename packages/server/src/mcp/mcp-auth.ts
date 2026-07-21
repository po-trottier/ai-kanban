import { type Actor } from '@rivian-kanban/core'
import { BearerAuthRequiredError } from '../errors.ts'
import { canonicalizeResource } from '../oauth/canonical-uri.ts'
import { ACCESS_TOKEN_PREFIX, sha256hex } from '../oauth/oauth-hash.ts'
import { hashServiceToken } from '../tokens/token-hash.ts'
import { type AppDeps } from '../types.ts'

/**
 * Bearer authentication for the /mcp Resource Server (ADR-021 §A). The one gate
 * accepts BOTH credential kinds a single-node deployment issues, resolving each
 * to the SAME downstream `Actor` so services, tools, and the policy engine are
 * untouched:
 *
 * - `rkb_…` service token → the ADR-021 §F headless path, unchanged: sha256 the
 *   credential, look up the stored hash, reject missing/unknown/revoked with 401.
 *   The Actor is `kind:'mcp'` (audited as the token id, with the token's role).
 * - anything else → an OAuth 2.1 access token our AS minted: sha256, look it up,
 *   reject unknown/revoked/expired/wrong-audience, then resolve the operator.
 *   The Actor is `kind:'agent'` acting AS the user (its id/role ARE the user's,
 *   so the policy engine bounds it to the operator's permissions), carrying the
 *   OAuth client so the audit reads "<client> on behalf of <user>".
 *
 * Every rejection is a uniform 401 (RFC 6750 `WWW-Authenticate: Bearer`) with no
 * detail that distinguishes which check tripped — no oracle for a leaked token.
 * Both challenges advertise the RFC 9728 resource-metadata URL (`errors.ts`) so
 * a client can discover the AS.
 */

/** `last_used_at` is observability, not audit — one write per minute per credential. */
const LAST_USED_THROTTLE_MS = 60_000

type BearerDeps = Pick<AppDeps, 'uow' | 'clock' | 'config'>

export async function authenticateBearer(
  deps: BearerDeps,
  authorization: string | undefined,
): Promise<Actor> {
  const rawToken = /^Bearer +(\S+)$/i.exec(authorization ?? '')?.[1]
  if (rawToken === undefined) {
    throw new BearerAuthRequiredError('a bearer token is required', false, deps.config.oauth.issuer)
  }

  return rawToken.startsWith(ACCESS_TOKEN_PREFIX)
    ? authenticateAccessToken(deps, rawToken)
    : authenticateServiceToken(deps, rawToken)
}

/** The unchanged `rkb_…` service-token path (ADR-021 §F): headless accounts stay. */
async function authenticateServiceToken(deps: BearerDeps, rawToken: string): Promise<Actor> {
  const tokenHash = hashServiceToken(rawToken)
  // Read-only path: this runs on EVERY /mcp request (exactly like session
  // authentication), so it must never queue behind the write FIFO.
  const token = await deps.uow.read((tx) => tx.serviceTokens.findByHash(tokenHash))
  // Unknown and revoked are indistinguishable — no oracle for leaked tokens.
  if (token?.revokedAt !== null) {
    throw reject(deps)
  }

  const now = deps.clock.now()
  if (throttleElapsed(token.lastUsedAt, now)) {
    await deps.uow.run((tx) => tx.serviceTokens.updateLastUsed(token.id, now.toISOString()))
  }

  return { kind: 'mcp', id: token.id, role: token.role, scope: token.scope }
}

/**
 * The OAuth access-token path (ADR-021 §A). Every failure — unknown, revoked,
 * expired, wrong audience (RFC 8707: a token minted for another `resource` MUST
 * NOT work here), or an operator who is gone/deactivated — is the identical 401.
 */
async function authenticateAccessToken(deps: BearerDeps, rawToken: string): Promise<Actor> {
  const tokenHash = sha256hex(rawToken)
  const now = deps.clock.now()
  // One read snapshot resolves the token plus its operator and client together
  // (like session auth: an indexed hash lookup, never behind the write FIFO).
  const { token, user, client } = await deps.uow.read(async (tx) => {
    const found = await tx.oauthAccessTokens.findByHash(tokenHash)
    if (found === null) return { token: null, user: null, client: null }
    return {
      token: found,
      user: await tx.users.findById(found.userId),
      client: await tx.oauthClients.findById(found.clientId),
    }
  })

  // Unknown token, or an operator that is gone/deactivated → uniform 401.
  if (token === null || !user?.isActive) {
    throw reject(deps)
  }
  if (
    token.revokedAt !== null ||
    new Date(token.expiresAt).getTime() <= now.getTime() ||
    // RFC 8707 audience binding: reject a token minted for a different resource.
    canonicalizeResource(token.resource) !== deps.config.oauth.canonicalMcpUri
  ) {
    throw reject(deps)
  }

  // A separate committed write so the read snapshot above is never held open
  // across a write (matches the service-token throttle).
  if (throttleElapsed(token.lastUsedAt, now)) {
    await deps.uow.run((tx) => tx.oauthAccessTokens.updateLastUsed(token.id, now.toISOString()))
  }

  // id/role ARE the user's (agent ≤ operator, ADR-021 §E); scope may narrow via
  // consent. `client.name` denormalizes onto the audit ("<client> on behalf of").
  return {
    kind: 'agent',
    id: token.userId,
    role: user.role,
    scope: token.scope,
    client: { id: token.clientId, name: client?.name ?? token.clientId },
  }
}

/** The uniform "a credential was presented and rejected" 401 (RFC 6750 + 9728). */
function reject(deps: BearerDeps): BearerAuthRequiredError {
  return new BearerAuthRequiredError(
    'unknown, expired, or invalid bearer token',
    true,
    deps.config.oauth.issuer,
  )
}

/** Whether the throttle window has elapsed since `lastUsedAt` (null = never used). */
function throttleElapsed(lastUsedAt: string | null, now: Date): boolean {
  return (
    lastUsedAt === null || now.getTime() - new Date(lastUsedAt).getTime() >= LAST_USED_THROTTLE_MS
  )
}
