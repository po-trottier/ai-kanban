import { z } from 'zod'

/**
 * Typed links between two cards (docs/architecture/card-relations.md). A
 * relation is stored as ONE directed row (`from → to`) carrying a type; the
 * inverse is derived when rendering the OTHER card's side. A deliberately small,
 * researched set (mirrors Linear/GitHub/Jira's common core, minus the rarely
 * used ones):
 *
 * - **`blocks`** (directional): `from` blocks `to`. The `to` card reads the
 *   inverse, "Blocked by". The operational dependency between work orders.
 * - **`duplicates`** (directional): `from` duplicates `to`. The `to` card reads
 *   "Duplicated by".
 * - **`relates_to`** (symmetric): a generic association — the same label from
 *   both cards, so it has no inverse.
 */
export const RELATION_TYPES = ['blocks', 'duplicates', 'relates_to'] as const
export type RelationType = (typeof RELATION_TYPES)[number]

/** Symmetric types read the same from both cards (no inverse label). */
export const SYMMETRIC_RELATION_TYPES: readonly RelationType[] = ['relates_to']

export function isSymmetricRelation(type: RelationType): boolean {
  return SYMMETRIC_RELATION_TYPES.includes(type)
}

/** Card ids are the positive-integer ticket numbers (data-model.md). */
const cardIdSchema = z.number().int().positive()

/** A stored, directed card-to-card relation. */
export const cardRelationSchema = z.strictObject({
  id: z.uuid(),
  fromCardId: cardIdSchema,
  toCardId: cardIdSchema,
  type: z.enum(RELATION_TYPES),
  createdAt: z.iso.datetime(),
})
export type CardRelation = z.infer<typeof cardRelationSchema>

/** `POST /cards/:id/relations` — link the route card (`from`) to `toCardId`. */
export const createCardRelationInputSchema = z.strictObject({
  toCardId: cardIdSchema,
  type: z.enum(RELATION_TYPES),
})
export type CreateCardRelationInput = z.infer<typeof createCardRelationInputSchema>

/**
 * Which end of the stored row a viewing card is on: `outgoing` = it is `from`
 * (reads the forward label), `incoming` = it is `to` (reads the inverse label).
 */
export const RELATION_DIRECTIONS = ['outgoing', 'incoming'] as const
export type RelationDirection = (typeof RELATION_DIRECTIONS)[number]

/**
 * A relation resolved FROM one card's perspective for display: the direction
 * plus the OTHER card's summary. The client picks the human label from
 * `(type, direction)` — see the web strings' `relationLabels`.
 */
export const cardRelationViewSchema = z.strictObject({
  id: z.uuid(),
  type: z.enum(RELATION_TYPES),
  direction: z.enum(RELATION_DIRECTIONS),
  /** The card on the OTHER side of the relation (never the viewing card). */
  card: z.strictObject({ id: cardIdSchema, title: z.string() }),
})
export type CardRelationView = z.infer<typeof cardRelationViewSchema>
