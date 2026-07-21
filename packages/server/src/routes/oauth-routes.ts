import { parse as parseQuery } from 'node:querystring'
import { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import { OAuthError } from '../oauth/oauth-errors.ts'
import {
  consentCsrfToken,
  renderConsentPage,
  verifyConsentCsrf,
  type ConsentParams,
} from '../oauth/consent-page.ts'
import { enforceBucket } from '../plugins/security.ts'
import { findMatchingRedirectUri } from '../oauth/redirect-match.ts'
import { rawSessionIdOf } from '../plugins/session-auth.ts'
import { type AppDeps } from '../types.ts'

/**
 * The `/oauth` authorization-server endpoints (ADR-021 §B), mounted OUTSIDE
 * /api/v1 (like /mcp) so the session-auth and JSON-CSRF hooks skip them by URL —
 * these routes resolve the session themselves and defend CSRF with a per-session
 * token. register/authorize/token/revoke; token+revoke+authorize-POST accept
 * `application/x-www-form-urlencoded` (what MCP clients send), parsed with
 * node:querystring in an encapsulated child so the parser never leaks to the
 * rest of the app.
 *
 * OAuth error format: RFC 6749 `{ error, error_description }` with the right
 * status — NOT the app's problem+json — so these handlers catch `OAuthError`
 * themselves rather than routing through the global mapper.
 */

/**
 * Renders an `OAuthError` as its RFC body. `invalid_grant` is DELIBERATELY a
 * fixed `{ error: 'invalid_grant' }` with NO description — the per-branch
 * messages (consumed vs expired vs bad PKCE) are an oracle; the real reason is
 * logged server-side only (security review finding 1).
 */
function sendOAuthError(reply: FastifyReply, request: FastifyRequest, err: OAuthError): void {
  if (err.code === 'invalid_grant') {
    request.log.warn({ reason: err.message }, 'oauth token grant rejected')
    void reply.code(400).type('application/json').send({ error: 'invalid_grant' })
    return
  }
  // Every AS error here is a request-shape 400 (invalid_client too: with
  // `token_endpoint_auth_method: none` there are no credentials to be 401 over).
  void reply
    .code(400)
    .type('application/json')
    .send({ error: err.code, error_description: err.message })
}

/** Best-effort string coercion of a single query/form field (arrays → first). */
function field(value: unknown): string {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : ''
  return typeof value === 'string' ? value : ''
}

/** snake_case authorize params (query or form) → the camelCase the service parses. */
function toAuthorizeRequest(source: Record<string, unknown>): {
  clientId: string
  redirectUri: string
  resource: string
  scope: string
  codeChallenge: string
  codeChallengeMethod: string
} {
  return {
    clientId: field(source.client_id),
    redirectUri: field(source.redirect_uri),
    resource: field(source.resource),
    scope: field(source.scope),
    codeChallenge: field(source.code_challenge),
    codeChallengeMethod: field(source.code_challenge_method),
  }
}

/** snake_case token params (urlencoded body) → the camelCase the service parses. */
function toTokenRequest(source: Record<string, unknown>): Record<string, unknown> {
  return {
    grantType: field(source.grant_type),
    code: field(source.code),
    codeVerifier: field(source.code_verifier),
    refreshToken: field(source.refresh_token),
    clientId: field(source.client_id),
    redirectUri: field(source.redirect_uri),
    // resource is optional; omit it when absent so the optional() schema holds.
    ...(source.resource !== undefined ? { resource: field(source.resource) } : {}),
  }
}

/** Appends `code`/`error` + `state` to a redirect URI (query, preserving any existing). */
function redirectWith(redirectUri: string, params: Record<string, string>): string {
  const url = new URL(redirectUri)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return url.toString()
}

export function oauthRoutes(deps: AppDeps) {
  return function routes(app: FastifyInstance): void {
    const { nodeEnv } = deps.config
    const registerBucket = app.createRateLimit({
      max: deps.config.rateLimits.oauthRegister.max,
      timeWindow: deps.config.rateLimits.oauthRegister.timeWindowMs,
      // Per IP — open registration's abuse surface (ADR-021 security).
      keyGenerator: (request) => `oauth-register:${request.ip}`,
    })

    /** Resolves the browser session to a user (or null) from the cookie. */
    const sessionUser = async (request: FastifyRequest) => {
      const rawSessionId = rawSessionIdOf(request, nodeEnv)
      if (rawSessionId === undefined || rawSessionId === '') return null
      const user = await deps.services.auth.authenticate(rawSessionId)
      return user === null ? null : { user, rawSessionId }
    }

    // POST /oauth/register (RFC 7591) — OPEN, JSON body, per-IP throttled.
    app.route({
      method: 'POST',
      url: '/oauth/register',
      onRequest: async (request, reply) => enforceBucket(registerBucket, request, reply),
      handler: async (request, reply) => {
        try {
          const response = await deps.services.oauthRegistration.register(request.body)
          await reply.code(201).type('application/json').send(response)
        } catch (err) {
          if (err instanceof OAuthError) {
            sendOAuthError(reply, request, err)
            return
          }
          throw err
        }
      },
    })

    // GET /oauth/authorize — the login+consent surface.
    app.route({
      method: 'GET',
      url: '/oauth/authorize',
      handler: async (request, reply) => {
        const query = request.query as Record<string, unknown>
        const resolved = await sessionUser(request)
        if (resolved === null) {
          // Not signed in: bounce through the SPA login, carrying the absolute
          // authorize URL so the SPA can send the browser back here afterwards.
          const authorizeUrl = `${deps.config.oauth.issuer}${request.url}`
          const loginUrl = `/login?returnTo=${encodeURIComponent(authorizeUrl)}`
          return reply.redirect(loginUrl, 302)
        }
        const params = toAuthorizeRequest(query)
        // Look the client up so the consent screen names it; an unknown client
        // is a plain error (we never redirect an unvalidated URI).
        const client = await deps.uow.read((tx) => tx.oauthClients.findById(params.clientId))
        if (client === null) {
          return reply
            .code(400)
            .type('application/json')
            .send({ error: 'invalid_client', error_description: 'unknown client' })
        }
        const scope = params.scope === 'read_write' ? 'read_write' : 'read'
        const consentParams: ConsentParams = {
          clientId: params.clientId,
          redirectUri: params.redirectUri,
          resource: params.resource,
          scope,
          codeChallenge: params.codeChallenge,
          codeChallengeMethod: params.codeChallengeMethod,
          state: field(query.state),
        }
        const html = renderConsentPage({
          clientName: client.name,
          scope,
          csrfToken: consentCsrfToken(resolved.rawSessionId),
          params: consentParams,
        })
        return reply.type('text/html; charset=utf-8').send(html)
      },
    })

    // POST /oauth/authorize — the consent form submit (urlencoded).
    // Encapsulated child so the urlencoded parser is scoped to these routes.
    app.register((scope, _opts, done) => {
      scope.addContentTypeParser(
        'application/x-www-form-urlencoded',
        { parseAs: 'string' },
        (_request, body, onDone) => {
          // node:querystring — no new dependency; the OAuth wire format is
          // exactly x-www-form-urlencoded.
          onDone(null, parseQuery(body as string))
        },
      )

      scope.route({
        method: 'POST',
        url: '/oauth/authorize',
        handler: async (request, reply) => {
          const body = (request.body ?? {}) as Record<string, unknown>
          const resolved = await sessionUser(request)
          // Session required (SameSite=Lax already blocks the cross-site POST)…
          if (resolved === null) {
            return reply
              .code(401)
              .type('application/json')
              .send({ error: 'access_denied', error_description: 'authentication required' })
          }
          // …AND a valid per-session CSRF token (defense-in-depth).
          if (!verifyConsentCsrf(resolved.rawSessionId, field(body.csrf))) {
            return reply
              .code(403)
              .type('application/json')
              .send({ error: 'access_denied', error_description: 'invalid csrf token' })
          }
          const params = toAuthorizeRequest(body)
          const state = field(body.state)
          // The redirect_uri must be registered for the client before we send
          // the browser to it — for BOTH approve and deny (open-redirect guard).
          const client = await deps.uow.read((tx) => tx.oauthClients.findById(params.clientId))
          const registeredRedirect =
            client === null
              ? null
              : findMatchingRedirectUri(client.redirectUris, params.redirectUri)
          if (registeredRedirect === null) {
            return reply
              .code(400)
              .type('application/json')
              .send({ error: 'invalid_request', error_description: 'unregistered redirect_uri' })
          }

          if (field(body.decision) !== 'approve') {
            // Deny → redirect back with access_denied (+ the original state).
            return reply.redirect(
              redirectWith(params.redirectUri, {
                error: 'access_denied',
                ...(state !== '' ? { state } : {}),
              }),
              302,
            )
          }

          let code: string
          try {
            ;({ code } = await deps.services.oauthAuthorization.authorize(resolved.user.id, params))
          } catch (err) {
            if (err instanceof OAuthError) {
              sendOAuthError(reply, request, err)
              return
            }
            throw err
          }
          await reply.redirect(
            redirectWith(params.redirectUri, {
              code,
              ...(state !== '' ? { state } : {}),
            }),
            302,
          )
        },
      })

      // POST /oauth/token — the token endpoint (urlencoded, no session).
      scope.route({
        method: 'POST',
        url: '/oauth/token',
        handler: async (request, reply) => {
          const body = (request.body ?? {}) as Record<string, unknown>
          try {
            const response = await deps.services.oauthToken.token(toTokenRequest(body))
            // RFC 6749 §5.1: token responses must not be cached.
            await reply
              .code(200)
              .header('cache-control', 'no-store')
              .type('application/json')
              .send(response)
          } catch (err) {
            if (err instanceof OAuthError) {
              sendOAuthError(reply, request, err)
              return
            }
            throw err
          }
        },
      })

      // POST /oauth/revoke (RFC 7009) — urlencoded; ALWAYS 200 (unknown token
      // is a success). Scoped to the presenting client.
      scope.route({
        method: 'POST',
        url: '/oauth/revoke',
        handler: async (request, reply) => {
          const body = (request.body ?? {}) as Record<string, unknown>
          const token = field(body.token)
          const clientId = field(body.client_id)
          if (token !== '' && clientId !== '') {
            await deps.services.oauthToken.revoke(token, clientId)
          }
          return reply.code(200).type('application/json').send({})
        },
      })

      done()
    })
  }
}
