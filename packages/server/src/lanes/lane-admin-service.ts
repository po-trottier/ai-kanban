import {
  ensureAdmin,
  NotFoundError,
  updateLaneInputSchema,
  type Actor,
  type EventBus,
  type Lane,
  type UnitOfWork,
} from '@rivian-kanban/core'

/**
 * Lane admin edits (docs/architecture/rest-api.md#admin: PATCH /lanes/:id —
 * label and WIP limit only). Lane keys and positions are structural — the
 * 7-lane workflow is seeded, never reshaped at runtime. Admin-only is an
 * always-on rule (security.md#authorization, core's `ensureAdmin`), and every
 * change publishes the board-scoped `lane.updated` hint (ADR-008).
 */

export interface LaneAdminServiceDeps {
  uow: UnitOfWork
  eventBus: EventBus
  boardId: string
}

export class LaneAdminService {
  private readonly deps: LaneAdminServiceDeps

  constructor(deps: LaneAdminServiceDeps) {
    this.deps = deps
  }

  /** Edits label and/or WIP limit; unknown lane 404, empty patch 400 (Zod). */
  async update(actor: Actor, laneId: string, rawInput: unknown): Promise<Lane> {
    ensureAdmin(actor)
    const input = updateLaneInputSchema.parse(rawInput)
    const updated = await this.deps.uow.run(async (tx) => {
      // Single board, 7 lanes — the board list doubles as the id lookup.
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
}
