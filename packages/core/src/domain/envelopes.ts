import { z } from 'zod'
import { cardSchema, userSchema, type Card } from './entities.ts'

/**
 * Read-envelope layouts shared by every surface (single-schema rule,
 * docs/dev/standards.md): the cursor page, the board snapshot, the
 * card-detail composition, and the admin-user envelopes are declared once,
 * parameterized by the entity schemas each surface supplies — core's strict
 * schemas where clients parse (web, MCP outputs), the server's stripping
 * response wrappers where serialization must strip.
 */

/** `{ items, nextCursor | null }` — the Zod form of core's `Page<T>`. */
export function pageSchemaOf<Item extends z.ZodType>(item: Item) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() })
}

/** The `CardDetail` envelope (`BoardQueryService.cardDetail`). */
export function cardDetailSchemaOf<
  C extends z.ZodType,
  T extends z.ZodType,
  L extends z.ZodType,
  A extends z.ZodType,
>(parts: { card: C; tag: T; location: L; attachment: A }) {
  return z.object({
    card: parts.card,
    tags: z.array(parts.tag),
    location: parts.location.nullable(),
    attachments: z.array(parts.attachment),
  })
}

/**
 * The board-snapshot card summary (rest-api.md: `GET /board` returns
 * "non-archived card summaries"): the full card minus `description` (up to
 * CARD_DESCRIPTION_MAX = 20k chars the board never renders — the detail panel
 * fetches `GET /cards/:id`) and the Slack/notification bookkeeping fields.
 * The hottest read in the system fans out to every connected client on every
 * mutation, so its body must not carry the unbounded done-lane backlog's
 * descriptions.
 */
export const boardCardSchema = cardSchema.omit({
  description: true,
  slackChannelId: true,
  slackThreadTs: true,
  slackPermalink: true,
  resumeAlertedAt: true,
})
export type BoardCard = z.infer<typeof boardCardSchema>

/** Stripping wrapper: projects a full row down to the declared summary roster. */
const boardCardStripSchema = z.object(boardCardSchema.shape)

/** Projects a full Card to its board summary — the pick roster IS boardCardSchema. */
export function boardCardOf(card: Card): BoardCard {
  return boardCardStripSchema.parse(card)
}

/** The `GET /board` envelope — the Zod form of core's `BoardSnapshot`. */
export function boardSnapshotSchemaOf<L extends z.ZodType, C extends z.ZodType>(parts: {
  lane: L
  card: C
}) {
  return z.object({
    lanes: z.array(
      z.object({ lane: parts.lane, cards: z.array(parts.card), wipLimitExceeded: z.boolean() }),
    ),
  })
}

/**
 * The `GET /users` picker roster — id, name, role picked from the user
 * schema. The email is optional because the server includes it only on admin
 * reads (the users admin table); every other role gets the email-free picker.
 */
export const pickerUserSchema = userSchema
  .pick({ id: true, displayName: true, role: true, email: true })
  .partial({ email: true })
export type PickerUser = z.infer<typeof pickerUserSchema>

/** `POST /users` / `PATCH /users/:id` — temp password present on create/reset only. */
export function userWithTempPasswordSchemaOf<U extends z.ZodType>(user: U) {
  return z.object({ user, tempPassword: z.string().optional() })
}
