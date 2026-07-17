/**
 * `If-Match` ↔ optimistic-lock version mapping (ADR-012). The server emits
 * `ETag: "<version>"` on card reads and mutations; clients echo it back.
 * Accepts a bare integer or an (optionally weak) quoted entity-tag.
 */

const IF_MATCH_PATTERN = /^\s*(?:W\/)?"?(\d{1,9})"?\s*$/

/** The version carried by an If-Match header value, or null when malformed. */
export function parseIfMatch(value: string): number | null {
  const match = IF_MATCH_PATTERN.exec(value)
  if (match?.[1] === undefined) return null
  const version = Number.parseInt(match[1], 10)
  return version >= 1 ? version : null
}

/** The ETag header value for a card version. */
export function etagOf(version: number): string {
  return `"${version.toString()}"`
}
