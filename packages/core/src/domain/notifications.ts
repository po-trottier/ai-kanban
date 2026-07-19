import { z } from 'zod'
import { CARD_EVENT_TYPES, type CardEventType } from './events.ts'

/**
 * A notification's kind: any card event that fanned out to watchers, PLUS a
 * direct `mention` (an @-mention in a comment — a higher-signal notification
 * that supersedes the generic comment notification for the mentioned user).
 */
export const NOTIFICATION_KINDS = [...CARD_EVENT_TYPES, 'mention'] as const
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]

/**
 * In-app notifications (docs/architecture/notifications.md). One row per
 * (recipient, triggering card event): when a watched card changes, every
 * watcher EXCEPT the actor gets a notification. The row records the triggering
 * `eventType` (a `CardEventType`); the human message is rendered client-side
 * from that plus the resolved actor name + card title, so there is no
 * denormalized copy to keep in sync.
 */
export const notificationSchema = z.strictObject({
  id: z.uuid(),
  /** The RECIPIENT user. */
  userId: z.uuid(),
  cardId: z.number().int().positive(),
  /** Who caused the event; null for the system actor. */
  actorId: z.uuid().nullable(),
  eventType: z.enum(NOTIFICATION_KINDS),
  createdAt: z.iso.datetime(),
  /** Null while unread; set to the read time once acknowledged. */
  readAt: z.iso.datetime().nullable(),
})
export type Notification = z.infer<typeof notificationSchema>

/**
 * A notification resolved for the inbox: the triggering event + the card title
 * and actor display name, plus a plain `read` flag. The client maps
 * `(eventType)` to a message.
 */
export const notificationViewSchema = z.strictObject({
  id: z.uuid(),
  cardId: z.number().int().positive(),
  cardTitle: z.string(),
  eventType: z.enum(NOTIFICATION_KINDS),
  /** The actor's display name, or null when the system acted. */
  actorName: z.string().nullable(),
  createdAt: z.iso.datetime(),
  read: z.boolean(),
})
export type NotificationView = z.infer<typeof notificationViewSchema>

/**
 * The card events worth a notification. Excludes pure-noise events: a within-
 * lane reorder, a PII redaction (internal), and comment edits/deletes (only the
 * original comment notifies). Everything else — a move, a field edit, block /
 * cancel / reopen, a new comment or attachment, and card creation (which
 * notifies a freshly-assigned assignee) — reaches the card's watchers.
 */
const NON_NOTIFIABLE: readonly CardEventType[] = [
  'card.reordered',
  'card.pii_deleted',
  'comment.edited',
  'comment.deleted',
]

export const NOTIFIABLE_EVENT_TYPES: readonly CardEventType[] = CARD_EVENT_TYPES.filter(
  (type) => !NON_NOTIFIABLE.includes(type),
)

export function isNotifiableEvent(type: CardEventType): boolean {
  return !NON_NOTIFIABLE.includes(type)
}
