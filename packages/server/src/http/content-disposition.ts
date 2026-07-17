/**
 * Download filename sanitization (docs/architecture/security.md#uploads):
 * CR/LF/quotes stripped so headers cannot be split, an ASCII-only fallback in
 * `filename=`, and the full UTF-8 name RFC 5987-encoded in `filename*`.
 */

const CONTROL_QUOTES_AND_SEPARATORS = /[\u0000-\u001f\u007f"\\/]/g
const NON_PRINTABLE_ASCII = /[^\u0020-\u007e]/g

/** Control chars (CR/LF included), quotes, backslashes, and slashes removed. */
export function sanitizeFilename(filename: string): string {
  const cleaned = filename.replaceAll(CONTROL_QUOTES_AND_SEPARATORS, '').trim()
  return cleaned === '' ? 'download' : cleaned
}

/** RFC 5987 `ext-value` percent-encoding (stricter than encodeURIComponent). */
function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replaceAll(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

/** A safe `Content-Disposition: attachment` header value for a stored filename. */
export function contentDispositionAttachment(filename: string): string {
  const sanitized = sanitizeFilename(filename)
  const asciiFallback = sanitized.replaceAll(NON_PRINTABLE_ASCII, '_')
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeRfc5987(sanitized)}`
}
