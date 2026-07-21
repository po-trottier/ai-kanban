import {
  tokenCodeGrantSchema,
  tokenRefreshGrantSchema,
  tokenRequestSchema,
  type Clock,
  type IdGenerator,
  type OAuthAccessToken,
  type OAuthRefreshToken,
  type TokenResponse,
  type TransactionContext,
  type UnitOfWork,
} from '@rivian-kanban/core'
import { canonicalizeResource } from './canonical-uri.ts'
import { type OAuthConfig } from './oauth-config.ts'
import { OAuthError } from './oauth-errors.ts'
import { ACCESS_TOKEN_PREFIX, mintSecret, REFRESH_TOKEN_PREFIX, sha256hex } from './oauth-hash.ts'
import { verifyPkce } from './pkce.ts'

/**
 * The `/oauth/token` endpoint (ADR-021 §C) — authorization_code and
 * refresh_token grants. Every access token is minted for the ONE canonical
 * `/mcp` audience (RFC 8707); refresh tokens rotate (each use issues a fresh one
 * in the same family and spends the old atomically), so a stolen refresh token's
 * reuse is detectable — reuse ⇒ revoke the whole family AND its access tokens.
 */

export interface TokenServiceDeps {
  uow: UnitOfWork
  clock: Clock
  ids: IdGenerator
  config: OAuthConfig
}

export class TokenService {
  private readonly deps: TokenServiceDeps

  constructor(deps: TokenServiceDeps) {
    this.deps = deps
  }

  /** Dispatches on `grant_type`; unknown grants are `unsupported_grant_type`. */
  async token(rawRequest: unknown): Promise<TokenResponse> {
    const request = tokenRequestSchema.parse(rawRequest)
    if (request.grantType === 'authorization_code') {
      return this.authorizationCodeGrant(request)
    }
    return this.refreshTokenGrant(request)
  }

  /**
   * authorization_code grant: atomically consume the code (single-use — a second
   * exchange finds nothing), assert it is unexpired and bound to this client +
   * redirect URI, verify PKCE, then mint an access token (for the code's
   * canonical resource) and a fresh-family refresh token.
   */
  private async authorizationCodeGrant(request: unknown): Promise<TokenResponse> {
    const grant = tokenCodeGrantSchema.parse(request)
    const now = this.deps.clock.now()
    // Burn the code FIRST, in its own committed transaction: a code is single-use
    // on ANY exchange attempt (OAuth 2.1). If validation below fails and we
    // throw, the burn must persist — otherwise a PKCE-failed attempt would leave
    // the code replayable, turning the token endpoint into a verifier brute-force
    // oracle. (Throwing inside one `run` ROLLs the consume back — see
    // SqliteUnitOfWork — so consume and validate can't share a transaction.)
    const code = await this.deps.uow.run((tx) =>
      tx.oauthAuthorizationCodes.consume(sha256hex(grant.code)),
    )
    // Uniform `invalid_grant` across every failure — no oracle for which check
    // tripped (consumed/absent vs expired vs wrong client vs bad verifier).
    if (code === null) throw new OAuthError('invalid_grant', 'invalid or used authorization code')
    if (new Date(code.expiresAt).getTime() <= now.getTime()) {
      throw new OAuthError('invalid_grant', 'authorization code expired')
    }
    if (code.clientId !== grant.clientId || code.redirectUri !== grant.redirectUri) {
      throw new OAuthError('invalid_grant', 'authorization code was issued to a different client')
    }
    if (!verifyPkce(grant.codeVerifier, code.codeChallenge)) {
      throw new OAuthError('invalid_grant', 'PKCE verification failed')
    }
    // The audience is the CODE's (already canonical); it is the app's one /mcp.
    return this.deps.uow.run((tx) =>
      this.issue(tx, {
        userId: code.userId,
        clientId: code.clientId,
        scope: code.scope,
        resource: code.resource,
        familyId: this.deps.ids.newId(),
        now,
      }),
    )
  }

  /**
   * refresh_token grant with rotation + reuse detection: look up the row; if
   * missing/expired/revoked ⇒ `invalid_grant`; else atomically `markUsed` — if
   * that returns FALSE the token was already spent (replay), so revoke the whole
   * family AND its access tokens and reject. On success, mint a NEW access token
   * and a NEW refresh token in the SAME family (rotation).
   *
   * The audience is bound from the STORED row, never the request — `resource` is
   * optional here on purpose (Codex omits it, OpenAI Codex #33403).
   */
  private async refreshTokenGrant(request: unknown): Promise<TokenResponse> {
    const grant = tokenRefreshGrantSchema.parse(request)
    const now = this.deps.clock.now()
    // The revoke-on-reuse write MUST commit even though the grant fails — so the
    // transaction reports reuse as a value and we throw AFTER it commits, never
    // by rolling the revoke back with the error (throwing inside `run` discards
    // the whole transaction, which would leave the stolen family alive).
    const result = await this.deps.uow.run<TokenResponse | { reuse: true }>(async (tx) => {
      const row = await tx.oauthRefreshTokens.findByHash(sha256hex(grant.refreshToken))
      if (row === null) throw new OAuthError('invalid_grant', 'invalid refresh token')
      if (row.revokedAt !== null || new Date(row.expiresAt).getTime() <= now.getTime()) {
        throw new OAuthError('invalid_grant', 'expired or revoked refresh token')
      }
      if (row.clientId !== grant.clientId) {
        throw new OAuthError('invalid_grant', 'refresh token was issued to a different client')
      }
      // Atomic rotation claim. False ⇒ already spent ⇒ REPLAY: burn the family
      // and every access token minted for the user in it (blast-radius bound).
      const claimed = await tx.oauthRefreshTokens.markUsed(row.id)
      if (!claimed) {
        await tx.oauthRefreshTokens.revokeFamily(row.familyId)
        await tx.oauthAccessTokens.revokeForUser(row.userId)
        return { reuse: true }
      }
      return this.issue(tx, {
        userId: row.userId,
        clientId: row.clientId,
        scope: row.scope,
        // Audience from the stored row (canonicalized once more, defensively).
        resource: canonicalizeResource(row.resource),
        familyId: row.familyId, // rotate WITHIN the same family
        now,
      })
    })
    if ('reuse' in result) throw new OAuthError('invalid_grant', 'refresh token reuse detected')
    return result
  }

  /**
   * Mints and persists an access token (for the given audience) + a refresh
   * token (in `familyId`) inside the caller's transaction, returning the token
   * endpoint response. Shared by both grants so issuance is identical.
   */
  private async issue(
    tx: TransactionContext,
    args: {
      userId: string
      clientId: string
      scope: OAuthAccessToken['scope']
      resource: string
      familyId: string
      now: Date
    },
  ): Promise<TokenResponse> {
    const { accessTokenTtlMs, refreshTokenTtlMs } = this.deps.config
    const nowIso = args.now.toISOString()
    const accessSecret = mintSecret(ACCESS_TOKEN_PREFIX)
    const refreshSecret = mintSecret(REFRESH_TOKEN_PREFIX)

    const accessToken: OAuthAccessToken = {
      id: this.deps.ids.newId(),
      tokenHash: accessSecret.hash,
      userId: args.userId,
      clientId: args.clientId,
      scope: args.scope,
      resource: args.resource,
      expiresAt: new Date(args.now.getTime() + accessTokenTtlMs).toISOString(),
      revokedAt: null,
      lastUsedAt: null,
      createdAt: nowIso,
    }
    const refreshToken: OAuthRefreshToken = {
      id: this.deps.ids.newId(),
      tokenHash: refreshSecret.hash,
      familyId: args.familyId,
      userId: args.userId,
      clientId: args.clientId,
      scope: args.scope,
      resource: args.resource,
      expiresAt: new Date(args.now.getTime() + refreshTokenTtlMs).toISOString(),
      usedAt: null,
      revokedAt: null,
      createdAt: nowIso,
    }
    await tx.oauthAccessTokens.insert(accessToken)
    await tx.oauthRefreshTokens.insert(refreshToken)

    return {
      access_token: accessSecret.raw,
      refresh_token: refreshSecret.raw,
      token_type: 'Bearer',
      expires_in: Math.floor(accessTokenTtlMs / 1000),
      scope: args.scope,
    }
  }
}
