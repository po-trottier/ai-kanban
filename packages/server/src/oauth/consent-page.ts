import { createHmac, timingSafeEqual } from 'node:crypto'
import { type TokenScope } from '@rivian-kanban/core'

/**
 * The server-rendered OAuth consent screen (ADR-021 §"Agent consent"). A
 * self-contained HTML page — NO inline `<script>` (the app's CSP has no
 * `script-src` inline; only `style-src 'unsafe-inline'` is relaxed, so the
 * inline `<style>` is allowed). A plain `<form method="POST">` with hidden
 * inputs carrying every authorize param plus a CSRF token, and approve/deny
 * submit buttons distinguished by their `name="decision"` value.
 *
 * CSRF: the token is `HMAC-SHA256(key = raw session id, message = 'oauth-consent')`.
 * The raw session id is the 256-bit cookie value the browser alone holds, so an
 * attacker who cannot read the cookie cannot forge the token. `__Host-sid` is
 * SameSite=Lax, so a cross-site POST carries no cookie ⇒ no session ⇒ rejected
 * before CSRF even runs; the token is defense-in-depth against a same-site
 * forgery. No server secret needed — the session id IS the per-user secret.
 */

const CSRF_MESSAGE = 'oauth-consent'

/** The CSRF token bound to a session — HMAC keyed on the raw (cookie) session id. */
export function consentCsrfToken(rawSessionId: string): string {
  return createHmac('sha256', rawSessionId).update(CSRF_MESSAGE).digest('hex')
}

/** Constant-time verification of a presented CSRF token against the session. */
export function verifyConsentCsrf(rawSessionId: string, presented: string): boolean {
  const expected = Buffer.from(consentCsrfToken(rawSessionId))
  const actual = Buffer.from(presented)
  if (expected.length !== actual.length) return false
  return timingSafeEqual(expected, actual)
}

/** The authorize params carried through the consent form as hidden inputs. */
export interface ConsentParams {
  clientId: string
  redirectUri: string
  resource: string
  scope: TokenScope
  codeChallenge: string
  codeChallengeMethod: string
  state: string
}

/** HTML-escape every interpolated value (defends against injection via client_name etc.). */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function hiddenInput(name: string, value: string): string {
  return `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}" />`
}

/** Human copy for the scope on the consent screen. */
function scopeCopy(scope: TokenScope): string {
  return scope === 'read_write' ? 'read + write' : 'read'
}

/**
 * Renders the consent HTML. `clientName` and every param are escaped; the two
 * submit buttons carry `decision=approve|deny` so the POST handler branches on
 * an explicit choice rather than an inferred one.
 */
export function renderConsentPage(args: {
  clientName: string
  scope: TokenScope
  csrfToken: string
  params: ConsentParams
}): string {
  const { clientName, scope, csrfToken, params } = args
  const hidden = [
    hiddenInput('clientId', params.clientId),
    hiddenInput('redirectUri', params.redirectUri),
    hiddenInput('resource', params.resource),
    hiddenInput('scope', params.scope),
    hiddenInput('codeChallenge', params.codeChallenge),
    hiddenInput('codeChallengeMethod', params.codeChallengeMethod),
    hiddenInput('state', params.state),
    hiddenInput('csrf', csrfToken),
  ].join('\n      ')

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Authorize access</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; background: #f4f5f7; color: #1a1b1e;
      display: flex; min-height: 100vh; align-items: center; justify-content: center; }
    main { background: #fff; border: 1px solid #dee2e6; border-radius: 8px; padding: 2rem;
      max-width: 26rem; width: 100%; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    h1 { font-size: 1.25rem; margin: 0 0 1rem; }
    p { line-height: 1.5; }
    .actions { display: flex; gap: 0.75rem; margin-top: 1.5rem; }
    button { flex: 1; padding: 0.6rem 1rem; border-radius: 6px; border: 1px solid #ced4da;
      font-size: 1rem; cursor: pointer; }
    button.approve { background: #228be6; border-color: #228be6; color: #fff; }
    button.deny { background: #fff; color: #1a1b1e; }
  </style>
</head>
<body>
  <main>
    <h1>Authorize access</h1>
    <p><strong>${escapeHtml(clientName)}</strong> wants to act on your behalf on Rivian Kanban
      (scope: ${escapeHtml(scopeCopy(scope))}). Allow?</p>
    <form method="POST" action="/oauth/authorize">
      ${hidden}
      <div class="actions">
        <button type="submit" name="decision" value="deny" class="deny">Deny</button>
        <button type="submit" name="decision" value="approve" class="approve">Allow</button>
      </div>
    </form>
  </main>
</body>
</html>`
}
