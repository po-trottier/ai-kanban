/**
 * Redirect-URI matching (ADR-021 security), shared by registration validation,
 * the authorize request, and the token exchange. The rule: EXACT string match,
 * EXCEPT loopback URIs match ignoring the PORT — Claude Code / Codex bind an
 * ephemeral loopback callback port per run (MCP OAuth spec / RFC 8252 §7.3), so
 * the port a client registers is not the port it later redirects to. Everything
 * else (HTTPS callbacks, hosts) stays exact.
 */

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

/** Is this a loopback `http://` URI (the only case where the port is ignored)? */
export function isLoopbackRedirectUri(uri: string): boolean {
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    return false
  }
  return url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)
}

/** A loopback URI reduced to `http://<host><path>` (port + query + hash dropped). */
function loopbackKey(url: URL): string {
  return `http://${url.hostname}${url.pathname}`
}

/**
 * True iff `candidate` matches `registered` under the redirect rule: byte-exact,
 * or — when both are loopback — equal ignoring the port. A parse failure on
 * either side falls back to exact string equality (never a loose match).
 */
export function redirectUriMatches(registered: string, candidate: string): boolean {
  if (registered === candidate) return true
  if (!isLoopbackRedirectUri(registered) || !isLoopbackRedirectUri(candidate)) return false
  return loopbackKey(new URL(registered)) === loopbackKey(new URL(candidate))
}

/** The registered URI that matches `candidate`, or null when none does. */
export function findMatchingRedirectUri(registered: string[], candidate: string): string | null {
  return registered.find((uri) => redirectUriMatches(uri, candidate)) ?? null
}
