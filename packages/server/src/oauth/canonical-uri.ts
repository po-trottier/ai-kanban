/**
 * RFC 8707 resource (audience) canonicalization (ADR-021 security). BOTH the
 * token's stored `resource` and any client-sent `resource` MUST pass through
 * this one normalizer before comparison — an audience mismatch from a trailing
 * slash or a mixed-case host is a silent-401 landmine.
 *
 * Normalization: lowercase scheme + host, drop the fragment, strip a single
 * trailing slash from the path, keep the (case-sensitive) path and port. A
 * value that is not a parseable absolute URI is returned unchanged (compared
 * verbatim) — the token exchange still rejects it on the equality check.
 */
export function canonicalizeResource(uri: string): string {
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    return uri
  }
  url.hash = ''
  // WHATWG URL already lowercases scheme + host and defaults an empty path to
  // "/". Strip a trailing slash off a NON-root path (`…/mcp/` → `…/mcp`); a
  // bare-origin "/" is left alone so both origin forms canonicalize equally.
  if (url.pathname !== '/' && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1)
  }
  return url.toString()
}

/** The app origin's canonical `/mcp` audience — every access token is minted for it. */
export function canonicalMcpUri(publicBaseUrl: string): string {
  return canonicalizeResource(`${publicBaseUrl.replace(/\/$/, '')}/mcp`)
}
