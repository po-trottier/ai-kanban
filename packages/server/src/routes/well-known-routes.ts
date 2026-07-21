import {
  authorizationServerMetadataSchema,
  protectedResourceMetadataSchema,
} from '@rivian-kanban/core'
import { type FastifyInstance } from 'fastify'
import { type ZodTypeProvider } from 'fastify-type-provider-zod'
import { type AppDeps } from '../types.ts'

/**
 * OAuth discovery metadata (ADR-021 §B), mounted OUTSIDE /api/v1 so the
 * session-auth and CSRF hooks skip it by URL — these endpoints are public by
 * design (a client discovers the AS before it has any token). RFC 8414 for the
 * authorization server, RFC 9728 for the protected resource.
 */
export function wellKnownRoutes(deps: AppDeps) {
  return function routes(app: FastifyInstance): void {
    const r = app.withTypeProvider<ZodTypeProvider>()
    const { issuer, canonicalMcpUri } = deps.config.oauth

    // RFC 8414 — the AS advertises its endpoints and capabilities.
    r.get(
      '/.well-known/oauth-authorization-server',
      { schema: { response: { 200: authorizationServerMetadataSchema } } },
      () => ({
        issuer,
        authorization_endpoint: `${issuer}/oauth/authorize`,
        token_endpoint: `${issuer}/oauth/token`,
        registration_endpoint: `${issuer}/oauth/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
      }),
    )

    // RFC 9728 — names the /mcp resource and the AS that issues tokens for it.
    // The RS 401/WWW-Authenticate discovery hop is a later slice; this only
    // serves the metadata document.
    r.get(
      '/.well-known/oauth-protected-resource',
      { schema: { response: { 200: protectedResourceMetadataSchema } } },
      () => ({ resource: canonicalMcpUri, authorization_servers: [issuer] }),
    )
  }
}
