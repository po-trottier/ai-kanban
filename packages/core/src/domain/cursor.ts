import { z } from 'zod'

/**
 * Opaque keyset-pagination cursor over `(created_at, id)` (docs/architecture/rest-api.md).
 * Encoded as base64url JSON so REST and MCP share one token format; clients never parse it.
 */
export const cursorKeySchema = z.strictObject({
  createdAt: z.iso.datetime(),
  /** Card list paginates on the integer card id; event feeds on the UUID event
   * id. One shared cursor token, so the tie-break id is either. */
  id: z.union([z.uuid(), z.number().int().positive()]),
})

export type CursorKey = z.infer<typeof cursorKeySchema>

/**
 * The WHATWG base64 globals, present in every supported runtime (browsers;
 * Node >= 16 — the repo requires >= 24). Declared here because core's
 * tsconfig deliberately loads no DOM/node type libs (environment-neutral).
 */
declare function btoa(data: string): string
declare function atob(data: string): string

/**
 * Encodes a validated cursor key as an opaque base64url token. The payload is
 * ASCII by construction (ISO datetime + UUID, validated above), so `btoa` —
 * a platform global in every supported runtime; core imports no node builtins
 * — is byte-exact over it; mapping `+/` to `-_` and dropping padding yields
 * RFC 4648 base64url.
 */
export function encodeCursor(key: CursorKey): string {
  const json = JSON.stringify(cursorKeySchema.parse(key))
  return btoa(json).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

/**
 * Decodes and validates an opaque cursor token.
 * Throws a ZodError (the validation error type) on any malformed input.
 */
export function decodeCursor(token: string): CursorKey {
  return cursorKeySchema.parse(tryParseJson(tryDecodeBase64Url(token)))
}

function tryDecodeBase64Url(token: string): string {
  try {
    return atob(token.replaceAll('-', '+').replaceAll('_', '/'))
  } catch {
    // Not base64 — surfaces as a ZodError from the schema parse above.
    return ''
  }
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}
