import { z } from 'zod'
import { laneKeySchema, prioritySchema, tagNameSchema } from './entities.ts'

/**
 * The board FILTER state — one flat object, every facet present so a preset can
 * set the COMPLETE state (never a partial overlay). The single schema shared by
 * the REST filter body, per-user preset storage, and the frontend form
 * (single-schema rule). See docs/architecture/board-filters.md.
 *
 * Multi-selects default to `[]` (matches everything on that facet); the scalars
 * carry their neutral default. Within a facet values are OR-ed (any-of), across
 * facets AND-ed. The empty filter (`{}`) is exactly today's unfiltered board.
 */

/** Archived selector: live cards only, archived only, or both. */
export const FILTER_SCOPES = ['active', 'archived', 'all'] as const
export type FilterScope = (typeof FILTER_SCOPES)[number]

export const boardFilterSchema = z.strictObject({
  /** Any-of priorities (P0/P1/P2). */
  priorities: z.array(prioritySchema).default([]),
  /** Any-of lanes/status by lane key. */
  laneKeys: z.array(laneKeySchema).default([]),
  /** Any-of assignee user ids. */
  assigneeIds: z.array(z.uuid()).default([]),
  /** Any-of reporter user ids. */
  reporterIds: z.array(z.uuid()).default([]),
  /** Any-of tag names, matched case-insensitively. */
  tags: z.array(tagNameSchema).default([]),
  /** Any-of location ids, each subtree-inclusive (a building matches its rooms). */
  locationIds: z.array(z.uuid()).default([]),
  /** Archived selector; defaults to live cards only (today's board). */
  scope: z.enum(FILTER_SCOPES).default('active'),
  /** Case-insensitive substring over title + description. */
  q: z.string().max(200).default(''),
  /** Computed time facet: elapsed business-minutes ≥ estimate (dates.isWorkOverdue). */
  overdue: z.boolean().default(false),
})
export type BoardFilter = z.infer<typeof boardFilterSchema>

/** The empty filter — every facet at its empty value (today's unfiltered board). */
export const EMPTY_BOARD_FILTER: BoardFilter = boardFilterSchema.parse({})

/**
 * A stored, user-owned filter preset (docs/architecture/board-filters.md). The
 * CUSTOM (CRUD) presets; the two built-ins below are core constants the
 * frontend renders, never rows. Per-user private — every read/write is scoped
 * to `ownerId`.
 */
export const filterPresetSchema = z.strictObject({
  id: z.uuid(),
  ownerId: z.uuid(),
  name: z.string().min(1).max(60),
  filter: boardFilterSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})
export type FilterPreset = z.infer<typeof filterPresetSchema>

/** `POST /filter-presets` — the caller owns the new preset (ownerId from the session). */
export const createFilterPresetInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(60),
  filter: boardFilterSchema,
})
export type CreateFilterPresetInput = z.infer<typeof createFilterPresetInputSchema>

/** `PATCH /filter-presets/:id` — rename and/or replace the saved filter. */
export const updateFilterPresetInputSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(60).optional(),
    filter: boardFilterSchema.optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, {
    message: 'at least one of name or filter is required',
  })
export type UpdateFilterPresetInput = z.infer<typeof updateFilterPresetInputSchema>

/**
 * A built-in preset the frontend renders (no owner, same for everyone). `key`
 * identifies it; `myCards` carries an empty `assigneeIds` the bar fills with the
 * current user's id at render time (only the client knows "me").
 */
export interface BuiltinFilterPreset {
  key: 'my_cards' | 'overdue'
  name: string
  filter: BoardFilter
}

/** The two built-in presets (docs/architecture/board-filters.md#built-in-presets). */
export const BUILTIN_FILTER_PRESETS: readonly BuiltinFilterPreset[] = [
  { key: 'my_cards', name: 'My Cards', filter: EMPTY_BOARD_FILTER },
  { key: 'overdue', name: 'Overdue', filter: { ...EMPTY_BOARD_FILTER, overdue: true } },
]
