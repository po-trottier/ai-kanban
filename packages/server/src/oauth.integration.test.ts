import { createHash, randomBytes } from 'node:crypto'
import { type LightMyRequestResponse } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { consentCsrfToken } from './oauth/consent-page.ts'
import { createTestApp, type TestApp } from './test/support.ts'

/**
 * The OAuth authorization-server HTTP flow end to end (ADR-021 slice 4) through
 * the real Fastify app: register → authorize (seeded session) → consent POST →
 * token (code) → token (refresh, rotated) → refresh REPLAY rejected → revoke.
 * Plus the security invariants: a fixed invalid_grant body, CSRF + session on
 * consent, the deny redirect, and `Cache-Control: no-store` on tokens.
 */

let t: TestApp
let cookie: string
const RESOURCE = 'http://localhost:3000/mcp'
const REDIRECT_URI = 'http://127.0.0.1:8765/callback'

/** A PKCE verifier + its S256 challenge (`base64url(sha256(verifier))`). */
function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

function form(fields: Record<string, string>): {
  payload: string
  headers: Record<string, string>
} {
  return {
    payload: new URLSearchParams(fields).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  }
}

/** POST an urlencoded body to an /oauth route with the session cookie set. */
function postForm(url: string, fields: Record<string, string>, withCookie = true) {
  const { payload, headers } = form(fields)
  return t.app.inject({
    method: 'POST',
    url,
    payload,
    headers: { ...headers, ...(withCookie ? { cookie: `sid=${cookie}` } : {}) },
  })
}

async function registerClient(): Promise<string> {
  const response = await t.app.inject({
    method: 'POST',
    url: '/oauth/register',
    headers: { 'content-type': 'application/json' },
    payload: { client_name: 'Codex', redirect_uris: [REDIRECT_URI] },
  })
  expect(response.statusCode).toBe(201)
  return response.json<{ client_id: string }>().client_id
}

/** Runs register → authorize GET → consent approve, returning the fresh code. */
async function obtainCode(
  clientId: string,
  challenge: string,
  scope = 'read_write',
): Promise<{ code: string; state: string }> {
  const state = randomBytes(8).toString('hex')
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    resource: RESOURCE,
    scope,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  })
  const consent = await t.app.inject({
    method: 'GET',
    url: `/oauth/authorize?${query.toString()}`,
    headers: { cookie: `sid=${cookie}` },
  })
  expect(consent.statusCode).toBe(200)
  expect(consent.body).toContain('Codex')

  const approve = await postForm('/oauth/authorize', {
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    resource: RESOURCE,
    scope,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    csrf: consentCsrfToken(cookie),
    decision: 'approve',
  })
  expect(approve.statusCode).toBe(302)
  const location = new URL(String(approve.headers.location))
  const code = location.searchParams.get('code')
  expect(code).not.toBeNull()
  expect(location.searchParams.get('state')).toBe(state)
  return { code: code ?? '', state }
}

function tokenBody(response: LightMyRequestResponse) {
  return response.json<{ access_token: string; refresh_token: string; scope: string }>()
}

/** Exchanges an authorization_code, asserting the grant succeeds; returns the response. */
async function codeGrant(
  clientId: string,
  code: string,
  verifier: string,
): Promise<LightMyRequestResponse> {
  return postForm(
    '/oauth/token',
    {
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      resource: RESOURCE,
    },
    false,
  )
}

/** register → authorize → consent → code grant, returning the first token pair. */
async function freshTokens(clientId: string): Promise<{
  access_token: string
  refresh_token: string
  scope: string
}> {
  const { verifier, challenge } = pkcePair()
  const { code } = await obtainCode(clientId, challenge)
  const response = await codeGrant(clientId, code, verifier)
  expect(response.statusCode).toBe(200)
  return tokenBody(response)
}

function refresh(clientId: string, refreshToken: string): Promise<LightMyRequestResponse> {
  return postForm(
    '/oauth/token',
    { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId },
    false,
  )
}

beforeAll(async () => {
  t = await createTestApp()
  const admin = await t.asRole('admin')
  cookie = admin.cookie
})

afterAll(async () => {
  await t.cleanup()
})

describe('OAuth authorization-server routes', () => {
  it('serves RFC 8414 authorization-server metadata', async () => {
    const response = await t.app.inject({
      method: 'GET',
      url: '/.well-known/oauth-authorization-server',
    })
    expect(response.statusCode).toBe(200)
    const body = response.json<Record<string, unknown>>()
    expect(body.token_endpoint).toBe('http://localhost:3000/oauth/token')
    expect(body.code_challenge_methods_supported).toEqual(['S256'])
    expect(body.token_endpoint_auth_methods_supported).toEqual(['none'])
  })

  it('serves RFC 9728 protected-resource metadata naming the AS', async () => {
    const response = await t.app.inject({
      method: 'GET',
      url: '/.well-known/oauth-protected-resource',
    })
    expect(response.statusCode).toBe(200)
    const body = response.json<{ resource: string; authorization_servers: string[] }>()
    expect(body.resource).toBe(RESOURCE)
    expect(body.authorization_servers).toEqual(['http://localhost:3000'])
  })

  it('runs the code grant with no-store and rotates the refresh token', async () => {
    const clientId = await registerClient()
    const { verifier, challenge } = pkcePair()
    const { code } = await obtainCode(clientId, challenge)

    const grant = await codeGrant(clientId, code, verifier)
    expect(grant.statusCode).toBe(200)
    // RFC 6749 §5.1 — token responses must not be cached.
    expect(grant.headers['cache-control']).toBe('no-store')
    const first = tokenBody(grant)
    expect(first.scope).toBe('read_write')
    expect(first.access_token).toMatch(/^rka_/)

    // refresh_token grant — rotation issues a DIFFERENT refresh token.
    const rotatedResponse = await refresh(clientId, first.refresh_token)
    expect(rotatedResponse.statusCode).toBe(200)
    expect(tokenBody(rotatedResponse).refresh_token).not.toBe(first.refresh_token)
  })

  it('rejects a refresh replay and revokes the whole family (reuse detection)', async () => {
    const clientId = await registerClient()
    const first = await freshTokens(clientId)
    const rotated = tokenBody(await refresh(clientId, first.refresh_token))

    // REPLAY the spent token — rejected, and reuse burns the whole family…
    const replay = await refresh(clientId, first.refresh_token)
    expect(replay.statusCode).toBe(400)
    expect(replay.json()).toEqual({ error: 'invalid_grant' })

    // …so even the freshly-rotated token is now dead.
    const rotatedReplay = await refresh(clientId, rotated.refresh_token)
    expect(rotatedReplay.statusCode).toBe(400)
    expect(rotatedReplay.json()).toEqual({ error: 'invalid_grant' })
  })

  it('revokes a refresh token (RFC 7009), always returning 200', async () => {
    const clientId = await registerClient()
    const { refresh_token } = await freshTokens(clientId)

    const revoke = await postForm(
      '/oauth/revoke',
      { token: refresh_token, client_id: clientId },
      false,
    )
    expect(revoke.statusCode).toBe(200)

    // The revoked token can no longer refresh.
    expect((await refresh(clientId, refresh_token)).statusCode).toBe(400)

    // Revoking an unknown token is still a success (RFC 7009 §2.2).
    const unknown = await postForm(
      '/oauth/revoke',
      { token: 'rkr_nope', client_id: clientId },
      false,
    )
    expect(unknown.statusCode).toBe(200)
  })

  it('returns a byte-identical invalid_grant body regardless of cause (finding 1)', async () => {
    const clientId = await registerClient()
    const { challenge } = pkcePair()

    // Cause A: a used/absent code (never issued).
    const absentCode = await postForm(
      '/oauth/token',
      {
        grant_type: 'authorization_code',
        code: 'never-issued',
        code_verifier: 'whatever',
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
      },
      false,
    )

    // Cause B: a real code but a WRONG PKCE verifier.
    const { code } = await obtainCode(clientId, challenge)
    const badVerifier = await postForm(
      '/oauth/token',
      {
        grant_type: 'authorization_code',
        code,
        code_verifier: 'not-the-verifier',
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
      },
      false,
    )

    expect(absentCode.statusCode).toBe(400)
    expect(badVerifier.statusCode).toBe(400)
    // Same status AND same body — no oracle for which check tripped.
    expect(absentCode.body).toBe(badVerifier.body)
    expect(absentCode.json()).toEqual({ error: 'invalid_grant' })
  })

  it('rejects the consent POST without a session', async () => {
    const clientId = await registerClient()
    const { challenge } = pkcePair()
    const response = await postForm(
      '/oauth/authorize',
      {
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        resource: RESOURCE,
        scope: 'read',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state: 's',
        csrf: consentCsrfToken(cookie),
        decision: 'approve',
      },
      false, // no cookie
    )
    expect(response.statusCode).toBe(401)
  })

  it('rejects the consent POST with a forged CSRF token', async () => {
    const clientId = await registerClient()
    const { challenge } = pkcePair()
    const response = await postForm('/oauth/authorize', {
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      resource: RESOURCE,
      scope: 'read',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 's',
      csrf: 'forged',
      decision: 'approve',
    })
    expect(response.statusCode).toBe(403)
  })

  it('redirects the browser to the SPA login when no session is present', async () => {
    const clientId = await registerClient()
    const { challenge } = pkcePair()
    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      resource: RESOURCE,
      scope: 'read',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 's',
    })
    const response = await t.app.inject({
      method: 'GET',
      url: `/oauth/authorize?${query.toString()}`,
    })
    expect(response.statusCode).toBe(302)
    const location = String(response.headers.location)
    expect(location.startsWith('/login?returnTo=')).toBe(true)
    // The returnTo is the absolute authorize URL, url-encoded.
    expect(decodeURIComponent(location)).toContain('/oauth/authorize')
  })

  it('deny redirects with error=access_denied and the original state', async () => {
    const clientId = await registerClient()
    const { challenge } = pkcePair()
    const response = await postForm('/oauth/authorize', {
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      resource: RESOURCE,
      scope: 'read',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'keep-me',
      csrf: consentCsrfToken(cookie),
      decision: 'deny',
    })
    expect(response.statusCode).toBe(302)
    const location = new URL(String(response.headers.location))
    expect(location.searchParams.get('error')).toBe('access_denied')
    expect(location.searchParams.get('state')).toBe('keep-me')
    expect(location.searchParams.get('code')).toBeNull()
  })
})
