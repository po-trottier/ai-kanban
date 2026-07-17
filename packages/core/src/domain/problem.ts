import { z } from 'zod'

/**
 * RFC 9457 problem+json — the error wire shape the server's problem mapper
 * emits and the SPA parses (docs/architecture/rest-api.md#conventions).
 * Declared once here (single-schema rule, docs/dev/standards.md): the server
 * types its validation issues with `ProblemIssue` and the web client parses
 * responses with `problemDetailsSchema`, so the two sides cannot drift.
 */

/**
 * One field-level validation issue. `path` is the joined string the server
 * serializes (`body.title`, `estimateMinutes`) — never a segment array.
 */
export const problemIssueSchema = z.object({
  path: z.string(),
  message: z.string(),
})
export type ProblemIssue = z.infer<typeof problemIssueSchema>

/**
 * Every field optional and unknown keys retained: clients must tolerate
 * problem documents from proxies and problem extensions (`rule`, `from`/`to`,
 * the current card on 409) ride along untyped.
 */
export const problemDetailsSchema = z.looseObject({
  type: z.string().optional(),
  title: z.string().optional(),
  status: z.number().int().optional(),
  detail: z.string().optional(),
  issues: z.array(problemIssueSchema).optional(),
})
export type ProblemDetails = z.infer<typeof problemDetailsSchema>
