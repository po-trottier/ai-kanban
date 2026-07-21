/**
 * Authorization-server tunables (ADR-021 §C). TTLs follow the ADR: short-lived
 * access tokens (~1 h) plus a long-lived, rotating refresh token (~45 d, inside
 * the 30–60 d band); authorization codes are single-use and ~60 s. `issuer` is
 * the app origin (RFC 8414); `canonicalMcpUri` is the one audience every access
 * token is minted for and the RS validates against (RFC 8707). The composition
 * root derives these from PUBLIC_BASE_URL and defaults the TTLs below.
 */
export interface OAuthConfig {
  /** RFC 8414 issuer — the app origin (PUBLIC_BASE_URL). */
  issuer: string
  /** The canonical `/mcp` audience (RFC 8707), already normalized. */
  canonicalMcpUri: string
  /** Authorization-code TTL — single-use, seconds-lived. */
  authCodeTtlMs: number
  /** Access-token TTL (~1 h). `expires_in` is derived from it. */
  accessTokenTtlMs: number
  /** Refresh-token TTL (~45 d sliding is a later concern; fixed here). */
  refreshTokenTtlMs: number
}

/** ADR-021 §C defaults — the TTLs, overridable through config. */
export const DEFAULT_OAUTH_TTLS = {
  authCodeTtlMs: 60_000,
  accessTokenTtlMs: 60 * 60_000,
  refreshTokenTtlMs: 45 * 86_400_000,
} as const
