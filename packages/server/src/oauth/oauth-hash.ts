import { createHash, randomBytes } from 'node:crypto'

/**
 * Opaque OAuth token hashing + minting (ADR-021 §C). The SAME sha256-hex
 * formula as `rkb_…` service tokens (tokens/token-hash.ts) and web sessions —
 * only the sha256 ever touches the db; the raw secret is returned once at mint.
 * If minting and lookup ever hashed differently, every issued token would
 * silently 401.
 */

/** access-token prefix (mirrors the `rkb_` service-token prefix). */
export const ACCESS_TOKEN_PREFIX = 'rka_'
/** refresh-token prefix. */
export const REFRESH_TOKEN_PREFIX = 'rkr_'

/** sha256 hex of a raw secret — the only form persisted. */
export function sha256hex(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

/**
 * A fresh opaque secret (`<prefix>` + 256 bits base64url) paired with the
 * sha256 that is all we store — the code/access/refresh secret generator.
 */
export function mintSecret(prefix: string): { raw: string; hash: string } {
  const raw = `${prefix}${randomBytes(32).toString('base64url')}`
  return { raw, hash: sha256hex(raw) }
}
