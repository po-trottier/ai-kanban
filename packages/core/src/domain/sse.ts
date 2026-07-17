import { z } from 'zod'
import { CARD_EVENT_TYPES } from './events.ts'

/**
 * SSE invalidation hints (ADR-008). Hints carry no data — clients refetch via
 * REST, keeping one serialization/authorization path.
 */

/** Card-scoped: `type` is the audit event_type; `eventId` its UUIDv7. */
export const cardSseHintSchema = z.strictObject({
  type: z.enum(CARD_EVENT_TYPES),
  cardId: z.uuid(),
  version: z.number().int().min(1),
  eventId: z.uuid(),
})
export type CardSseHint = z.infer<typeof cardSseHintSchema>

export const BOARD_HINT_TYPES = [
  'policy.updated',
  'lane.updated',
  'user.updated',
  'location.updated',
] as const

/** Board-scoped: admin/config changes that alter everyone's affordances live. */
export const boardSseHintSchema = z.strictObject({
  type: z.enum(BOARD_HINT_TYPES),
})
export type BoardSseHint = z.infer<typeof boardSseHintSchema>

export const sseHintSchema = z.discriminatedUnion('type', [cardSseHintSchema, boardSseHintSchema])
export type SseHint = z.infer<typeof sseHintSchema>
