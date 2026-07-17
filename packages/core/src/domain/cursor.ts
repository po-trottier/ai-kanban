import { z } from 'zod'

/**
 * Opaque keyset-pagination cursor over `(created_at, id)` (docs/architecture/rest-api.md).
 * Encoded as base64url JSON so REST and MCP share one token format; clients never parse it.
 */
export const cursorKeySchema = z.strictObject({
  createdAt: z.iso.datetime(),
  id: z.uuid(),
})

export type CursorKey = z.infer<typeof cursorKeySchema>

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/** Encodes a validated cursor key as an opaque base64url token. */
export function encodeCursor(key: CursorKey): string {
  const json = JSON.stringify(cursorKeySchema.parse(key))
  let out = ''
  for (let i = 0; i < json.length; i += 3) {
    const b0 = json.charCodeAt(i)
    const b1 = i + 1 < json.length ? json.charCodeAt(i + 1) : undefined
    const b2 = i + 2 < json.length ? json.charCodeAt(i + 2) : undefined
    out += BASE64URL.charAt(b0 >> 2)
    out += BASE64URL.charAt(((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4))
    if (b1 !== undefined) out += BASE64URL.charAt(((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6))
    if (b2 !== undefined) out += BASE64URL.charAt(b2 & 0x3f)
  }
  return out
}

/**
 * Decodes and validates an opaque cursor token.
 * Throws a ZodError (the validation error type) on any malformed input.
 */
export function decodeCursor(token: string): CursorKey {
  return cursorKeySchema.parse(tryParseJson(decodeBase64Url(token)))
}

function decodeBase64Url(token: string): string {
  const sextets: number[] = []
  for (const char of token) {
    const value = BASE64URL.indexOf(char)
    if (value === -1) return ''
    sextets.push(value)
  }
  let out = ''
  for (let i = 0; i + 1 < sextets.length; i += 4) {
    const s0 = sextets.at(i) ?? 0
    const s1 = sextets.at(i + 1) ?? 0
    const s2 = sextets.at(i + 2)
    const s3 = sextets.at(i + 3)
    out += String.fromCharCode((s0 << 2) | (s1 >> 4))
    if (s2 !== undefined) out += String.fromCharCode(((s1 & 0x0f) << 4) | (s2 >> 2))
    if (s2 !== undefined && s3 !== undefined) out += String.fromCharCode(((s2 & 0x03) << 6) | s3)
  }
  return out
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}
