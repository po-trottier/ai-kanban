import {
  authorizeRequestSchema,
  type Clock,
  type IdGenerator,
  type OAuthAuthorizationCode,
  type UnitOfWork,
} from '@rivian-kanban/core'
import { canonicalizeResource } from './canonical-uri.ts'
import { type OAuthConfig } from './oauth-config.ts'
import { OAuthError } from './oauth-errors.ts'
import { assertS256 } from './pkce.ts'
import { mintSecret } from './oauth-hash.ts'
import { findMatchingRedirectUri } from './redirect-match.ts'

/**
 * The AS authorize step (ADR-021 §B): given an ALREADY-AUTHENTICATED user
 * (resolved from the session by the slice-4 route) and a validated authorize
 * request, verify the client + redirect URI, then mint a single-use, ~60 s
 * authorization code bound to (clientId, redirectUri, canonical resource, scope,
 * PKCE challenge, userId). Returns the RAW code for the redirect; only its
 * sha256 persists.
 *
 * Consent is a slice-4 concern (the route shows/records it); this service is the
 * code-minting core once the user has approved.
 */

export interface AuthorizationServiceDeps {
  uow: UnitOfWork
  clock: Clock
  ids: IdGenerator
  config: OAuthConfig
}

export class AuthorizationService {
  private readonly deps: AuthorizationServiceDeps

  constructor(deps: AuthorizationServiceDeps) {
    this.deps = deps
  }

  /** Mints an authorization code for `userId`, returning the raw code. */
  async authorize(userId: string, rawRequest: unknown): Promise<{ code: string }> {
    const request = authorizeRequestSchema.parse(rawRequest)
    assertS256(request.codeChallengeMethod)
    // RFC 8707 audience: canonicalize the client-sent `resource` through the ONE
    // normalizer, then require it to be our single `/mcp` audience — we are the
    // sole token issuer for exactly that resource (ADR-021), so a code (and thus
    // its access token) can only ever be minted for it. A trailing-slash/case
    // variant normalizes to the same value and passes; anything else is rejected
    // here rather than becoming a token the RS silently 401s later.
    const resource = canonicalizeResource(request.resource)
    if (resource !== this.deps.config.canonicalMcpUri) {
      throw new OAuthError('invalid_request', 'unsupported resource (audience)')
    }

    // Opaque single-use code — no prefix (it is redeemed once, never a bearer).
    const { raw: code, hash: codeHash } = mintSecret('')
    const expiresAt = new Date(
      this.deps.clock.now().getTime() + this.deps.config.authCodeTtlMs,
    ).toISOString()

    await this.deps.uow.run(async (tx) => {
      const client = await tx.oauthClients.findById(request.clientId)
      if (client === null) throw new OAuthError('invalid_client', 'unknown client')
      if (findMatchingRedirectUri(client.redirectUris, request.redirectUri) === null) {
        throw new OAuthError('invalid_redirect_uri', 'redirect_uri not registered for this client')
      }
      const row: OAuthAuthorizationCode = {
        codeHash,
        clientId: request.clientId,
        userId,
        redirectUri: request.redirectUri,
        resource,
        scope: request.scope,
        codeChallenge: request.codeChallenge,
        codeChallengeMethod: 'S256',
        expiresAt,
      }
      await tx.oauthAuthorizationCodes.insert(row)
    })
    return { code }
  }
}
