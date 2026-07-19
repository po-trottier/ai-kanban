import {
  ConflictError,
  createLaneInputSchema,
  ensurePermission,
  isSystemLaneKey,
  laneKeySchema,
  NotFoundError,
  reorderLanesInputSchema,
  updateLaneInputSchema,
  type Actor,
  type EventBus,
  type IdGenerator,
  type Lane,
  type UnitOfWork,
} from '@rivian-kanban/core'
import { loadActivePolicy } from '../authz.ts'

/**
 * Lane admin (docs/architecture/rest-api.md#admin): columns are fully
 * configurable — add, rename/WIP (PATCH), reorder, and remove. The 7 SEEDED
 * lanes carry the workflow behavior (intake entry, in-progress work-start,
 * waiting discipline, done terminal), so they are renamable and reorderable
 * but PROTECTED from deletion; admin-added lanes are plain and removable when
 * empty. Every mutation is gated by the `manageLanes` permission of the active
 * policy (ADR-013) and publishes the board-scoped `lane.updated` hint (ADR-008).
 */

export interface LaneAdminServiceDeps {
  uow: UnitOfWork
  eventBus: EventBus
  ids: IdGenerator
  boardId: string
}

export class LaneAdminService {
  private readonly deps: LaneAdminServiceDeps

  constructor(deps: LaneAdminServiceDeps) {
    this.deps = deps
  }

  /** Edits label and/or WIP limit; unknown lane 404, empty patch 400 (Zod). */
  async update(actor: Actor, laneId: string, rawInput: unknown): Promise<Lane> {
    const input = updateLaneInputSchema.parse(rawInput)
    const updated = await this.deps.uow.run(async (tx) => {
      ensurePermission(actor, 'manageLanes', await loadActivePolicy(tx, this.deps.boardId))
      // Single board — the board list doubles as the id lookup.
      const lane = (await tx.lanes.listByBoard(this.deps.boardId)).find(
        (candidate) => candidate.id === laneId,
      )
      if (lane === undefined) throw new NotFoundError('lane')
      const next: Lane = {
        ...lane,
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.wipLimit !== undefined ? { wipLimit: input.wipLimit } : {}),
      }
      await tx.lanes.update(next)
      return next
    })
    this.deps.eventBus.publish({ type: 'lane.updated' })
    return updated
  }

  /** Adds a column at the end of the board; the machine key is derived from the label. */
  async create(actor: Actor, rawInput: unknown): Promise<Lane> {
    const input = createLaneInputSchema.parse(rawInput)
    const created = await this.deps.uow.run(async (tx) => {
      ensurePermission(actor, 'manageLanes', await loadActivePolicy(tx, this.deps.boardId))
      const existing = await tx.lanes.listByBoard(this.deps.boardId)
      const key = uniqueLaneKey(input.label, new Set(existing.map((lane) => lane.key)))
      const position = existing.reduce((max, lane) => Math.max(max, lane.position), -1) + 1
      const lane: Lane = {
        id: this.deps.ids.newId(),
        boardId: this.deps.boardId,
        key,
        label: input.label,
        position,
        wipLimit: input.wipLimit,
      }
      await tx.lanes.insert(lane)
      return lane
    })
    this.deps.eventBus.publish({ type: 'lane.updated' })
    return created
  }

  /** Removes an admin-added column; 409 for a seeded lane or a non-empty one, 404 if unknown. */
  async remove(actor: Actor, laneId: string): Promise<void> {
    await this.deps.uow.run(async (tx) => {
      ensurePermission(actor, 'manageLanes', await loadActivePolicy(tx, this.deps.boardId))
      const lane = (await tx.lanes.listByBoard(this.deps.boardId)).find(
        (candidate) => candidate.id === laneId,
      )
      if (lane === undefined) throw new NotFoundError('lane')
      if (isSystemLaneKey(lane.key)) {
        throw new ConflictError('the built-in workflow columns cannot be deleted')
      }
      // edgeOfLane includes archived rows: a non-null edge means cards remain.
      if ((await tx.cards.edgeOfLane(lane.id, 'first')) !== null) {
        throw new ConflictError('move its cards to another column before deleting it')
      }
      await tx.lanes.remove(lane.id)
    })
    this.deps.eventBus.publish({ type: 'lane.updated' })
  }

  /** Rewrites column order; the payload must list every lane on the board exactly once. */
  async reorder(actor: Actor, rawInput: unknown): Promise<Lane[]> {
    const input = reorderLanesInputSchema.parse(rawInput)
    const reordered = await this.deps.uow.run(async (tx) => {
      ensurePermission(actor, 'manageLanes', await loadActivePolicy(tx, this.deps.boardId))
      const existing = await tx.lanes.listByBoard(this.deps.boardId)
      const existingIds = new Set(existing.map((lane) => lane.id))
      const requested = new Set(input.orderedIds)
      if (
        input.orderedIds.length !== existing.length ||
        requested.size !== input.orderedIds.length ||
        !input.orderedIds.every((id) => existingIds.has(id))
      ) {
        throw new ConflictError('the reorder must list every column exactly once')
      }
      await tx.lanes.reorder(this.deps.boardId, input.orderedIds)
      return tx.lanes.listByBoard(this.deps.boardId)
    })
    this.deps.eventBus.publish({ type: 'lane.updated' })
    return reordered
  }
}

/** A stable machine key from a human label: a slug matching laneKeySchema, deduped. */
function uniqueLaneKey(label: string, taken: Set<string>): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/^(\d)/, 'lane_$1')
      .slice(0, 36) || 'lane'
  let key = base
  let suffix = 2
  while (taken.has(key)) {
    key = `${base}_${String(suffix)}`
    suffix += 1
  }
  return laneKeySchema.parse(key)
}
