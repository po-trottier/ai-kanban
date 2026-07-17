import { type Actor } from '@rivian-kanban/core'
import { BearerAuthRequiredError } from '../errors.ts'
import { hashServiceToken } from '../tokens/token-hash.ts'
import { type AppDeps } from '../types.ts'

/**
 * Bearer service-token authentication for /mcp
 * (docs/architecture/mcp.md#authentication): sha256 the presented `rkb_…`
 * credential, look up the stored hash, reject missing/unknown/revoked tokens
 * with 401 + `WWW-Authenticate: Bearer`. The resulting Actor carries the
 * token id (audited as `actor_kind: 'mcp'`), its role (policy gates) and its
 * scope (the always-on read/read_write identity rule).
 */

/** `last_used_at` is observability, not audit — one write per minute per token. */
const LAST_USED_THROTTLE_MS = 60_000

export async function authenticateBearer(
  deps: Pick<AppDeps, 'uow' | 'clock'>,
  authorization: string | undefined,
): Promise<Actor> {
  const rawToken = /^Bearer +(\S+)$/i.exec(authorization ?? '')?.[1]
  if (rawToken === undefined) {
    throw new BearerAuthRequiredError('a bearer service token is required', false)
  }

  const tokenHash = hashServiceToken(rawToken)
  // Read-only path: this runs on EVERY /mcp request (exactly like session
  // authentication), so it must never queue behind the write FIFO.
  const token = await deps.uow.read((tx) => tx.serviceTokens.findByHash(tokenHash))
  // Unknown and revoked are indistinguishable — no oracle for leaked tokens.
  if (token?.revokedAt !== null) {
    throw new BearerAuthRequiredError('unknown or revoked service token', true)
  }

  const now = deps.clock.now()
  if (
    token.lastUsedAt === null ||
    now.getTime() - new Date(token.lastUsedAt).getTime() >= LAST_USED_THROTTLE_MS
  ) {
    await deps.uow.run((tx) => tx.serviceTokens.updateLastUsed(token.id, now.toISOString()))
  }

  return { kind: 'mcp', id: token.id, role: token.role, scope: token.scope }
}
