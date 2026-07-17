import { createHash } from 'node:crypto'

/**
 * The one hashing of raw `rkb_…` service-token credentials (sha256 hex,
 * ADR-009). Shared by minting (ServiceTokenService.create) and /mcp bearer
 * verification (authenticateBearer): if the two ever diverged — encoding,
 * pepper, algorithm — every issued token would silently stop matching and
 * die with an unhelpful 401.
 */
export function hashServiceToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex')
}
